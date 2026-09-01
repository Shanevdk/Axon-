<?php

namespace App\Actions\Site;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Measures the ground over a property.
 *
 * A square of coordinates is laid over the site, each one asked of a free
 * elevation service, and the answers come back as the `Site` the drawing
 * stores: heights in millimetres above the ground floor rather than metres
 * above the sea, because that is what the model is built in.
 *
 * What this is not: a survey. The data behind it is a 30m terrain model with
 * a few metres of vertical error, which is enough to see that a site falls
 * to the north and to draw the ground under an elevation, and nowhere near
 * enough to set a footing off. The source is returned with the levels so the
 * drawing can say so.
 */
class FetchGroundLevels
{
    /** Coordinates the service accepts in one request. */
    private const BATCH = 100;

    /** Samples along each side by default: 81 points, a single request. */
    public const STEPS = 8;

    /** More than this is false precision against a 30m source. */
    public const MAX_STEPS = 12;

    /** How wide a property to measure, in metres. */
    public const MIN_SPAN = 20;

    public const MAX_SPAN = 2000;

    /**
     * Metres per degree of latitude. Longitude narrows towards the poles and
     * is scaled by the cosine of the latitude below.
     */
    private const METRES_PER_DEGREE = 111_320.0;

    /** The shape of the land does not change, so this is a long hold. */
    private const CACHE_DAYS = 30;

    /**
     * Coordinates are rounded before they become a cache key, so nudging a
     * pin by a few metres reuses the answer instead of asking again.
     */
    private const PRECISION = 4;

    /**
     * Measure the ground around a point.
     *
     * @param  int  $span  How wide a square to cover, in metres.
     * @return array{
     *     latitude: float,
     *     longitude: float,
     *     seaLevel: float,
     *     source: string,
     *     terrain: array{
     *         originX: float, originY: float, spacing: float,
     *         columns: int, rows: int, heights: array<int, int>
     *     }
     * }
     *
     * @throws RuntimeException when the service cannot be reached or answers
     *                          with something that is not a set of heights
     */
    public function handle(
        float $latitude,
        float $longitude,
        int $span,
        int $steps = self::STEPS,
    ): array {
        $latitude = round($latitude, self::PRECISION);
        $longitude = round($longitude, self::PRECISION);
        $span = (int) max(self::MIN_SPAN, min(self::MAX_SPAN, $span));

        // An even number of steps puts a sample exactly on the centre, which
        // is the one the whole survey is levelled against.
        $steps = (int) max(2, min(self::MAX_STEPS, $steps));
        $steps -= $steps % 2;

        $key = "ground:{$latitude},{$longitude},{$span},{$steps}";

        $levels = Cache::remember(
            $key,
            now()->addDays(self::CACHE_DAYS),
            fn (): ?array => $this->measure($latitude, $longitude, $span, $steps),
        );

        if ($levels === null) {
            // A failed lookup is not worth remembering for a month.
            Cache::forget($key);

            throw new RuntimeException(
                'Could not read the ground levels for that spot. Try again in a moment.'
            );
        }

        return $this->assemble($latitude, $longitude, $span, $steps, $levels);
    }

    /**
     * Turn a list of heights above sea level into the site the model stores.
     *
     * @param  array<int, float>  $levels
     * @return array<string, mixed>
     */
    private function assemble(
        float $latitude,
        float $longitude,
        int $span,
        int $steps,
        array $levels,
    ): array {
        // The middle sample becomes the datum: ground level at the centre of
        // the property is model zero, so the ground floor starts on the
        // ground and no number in the document runs to hundreds of metres.
        $middle = (int) (($steps / 2) * ($steps + 1) + ($steps / 2));
        $seaLevel = $levels[$middle] ?? 0.0;

        // Cast rather than let PHP hand back an int for spans that divide
        // evenly: the client reads these as plain numbers and should never
        // have to care that a 40m property is exact and a 45m one is not.
        $origin = (float) (-($span * 1000) / 2);

        return [
            'latitude' => $latitude,
            'longitude' => $longitude,
            'seaLevel' => round($seaLevel, 2),
            'source' => (string) config('services.ground.label'),
            'terrain' => [
                'originX' => $origin,
                'originY' => $origin,
                'spacing' => (float) (($span * 1000) / $steps),
                'columns' => $steps + 1,
                'rows' => $steps + 1,
                'heights' => array_map(
                    fn (float $level): int => (int) round(($level - $seaLevel) * 1000),
                    $levels,
                ),
            ],
        ];
    }

    /**
     * Ask the service for every sample, in as few requests as it allows.
     *
     * @return array<int, float>|null
     */
    private function measure(
        float $latitude,
        float $longitude,
        int $span,
        int $steps,
    ): ?array {
        $points = $this->grid($latitude, $longitude, $span, $steps);
        $levels = [];

        foreach (array_chunk($points, self::BATCH) as $batch) {
            $answer = $this->ask($batch);

            if ($answer === null || count($answer) !== count($batch)) {
                return null;
            }

            $levels = [...$levels, ...$answer];
        }

        return $levels;
    }

    /**
     * The coordinates to measure, row-major from the south-west corner: east
     * along a row, then north to the next one. That is the order the model's
     * `Terrain` reads its heights in, so the two must not drift apart.
     *
     * @return array<int, array{lat: float, lon: float}>
     */
    private function grid(
        float $latitude,
        float $longitude,
        int $span,
        int $steps,
    ): array {
        $spacing = $span / $steps;

        // Degrees of longitude are shorter than degrees of latitude by the
        // cosine of where you are. Held away from zero so a property at the
        // pole asks for coordinates rather than dividing by nothing.
        $narrowing = max(0.01, cos(deg2rad($latitude)));

        $points = [];

        for ($row = 0; $row <= $steps; $row++) {
            for ($column = 0; $column <= $steps; $column++) {
                $north = ($row - $steps / 2) * $spacing;
                $east = ($column - $steps / 2) * $spacing;

                $points[] = [
                    'lat' => round(
                        $latitude + $north / self::METRES_PER_DEGREE,
                        6,
                    ),
                    'lon' => round(
                        $longitude + $east / (self::METRES_PER_DEGREE * $narrowing),
                        6,
                    ),
                ];
            }
        }

        return $points;
    }

    /**
     * One request's worth of coordinates.
     *
     * @param  array<int, array{lat: float, lon: float}>  $points
     * @return array<int, float>|null
     */
    private function ask(array $points): ?array
    {
        try {
            $response = Http::timeout((int) config('services.ground.timeout', 20))
                ->acceptJson()
                ->get((string) config('services.ground.url'), [
                    'latitude' => implode(',', array_column($points, 'lat')),
                    'longitude' => implode(',', array_column($points, 'lon')),
                ]);
        } catch (\Throwable $failure) {
            Log::warning('Ground levels could not be reached.', [
                'message' => $failure->getMessage(),
            ]);

            return null;
        }

        if ($response->failed()) {
            Log::warning('Ground levels refused.', ['status' => $response->status()]);

            return null;
        }

        $elevations = $response->json('elevation');

        if (! is_array($elevations) || $elevations === []) {
            return null;
        }

        foreach ($elevations as $elevation) {
            if (! is_numeric($elevation)) {
                return null;
            }
        }

        return array_map(fn ($elevation): float => (float) $elevation, $elevations);
    }
}
