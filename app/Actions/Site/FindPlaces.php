<?php

namespace App\Actions\Site;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Turns a typed address into places on the earth.
 *
 * The other direction from the reverse geocoder the code assistant uses:
 * this takes "1490 West 7th, Vancouver" and hands back somewhere to put the
 * pin. What comes back is a shortlist rather than an answer, because an
 * address is often ambiguous and the person siting the building is better
 * placed to choose than a ranking is.
 *
 * Nothing here is authoritative. A geocoder puts you on the right lot, not on
 * the right corner of it, which is why the picker lets the pin be dragged
 * afterwards and why the coordinates it produces are a starting point for a
 * survey rather than a substitute for one.
 */
class FindPlaces
{
    /** Candidates worth showing. More than this is a longer list, not a better one. */
    public const LIMIT = 6;

    /** Shorter than this is not an address, it is a keystroke. */
    public const MIN_QUERY = 3;

    /** Addresses do not move, and the service asks to be spared. */
    private const CACHE_DAYS = 30;

    /**
     * Look up an address.
     *
     * @return array<int, array{label: string, latitude: float, longitude: float, region: string|null}>
     */
    public function handle(string $query): array
    {
        $query = Str::squish($query);

        if (Str::length($query) < self::MIN_QUERY) {
            return [];
        }

        $key = 'places:'.Str::lower($query);

        $found = Cache::remember(
            $key,
            now()->addDays(self::CACHE_DAYS),
            fn (): ?array => $this->ask($query),
        );

        if ($found === null) {
            // A service that was down once is not down for a month.
            Cache::forget($key);

            return [];
        }

        return $found;
    }

    /**
     * @return array<int, array{label: string, latitude: float, longitude: float, region: string|null}>|null
     */
    private function ask(string $query): ?array
    {
        try {
            $response = Http::timeout((int) config('services.places.timeout', 15))
                // Nominatim's terms ask to be told who is calling, and will
                // refuse a request that does not say.
                ->withUserAgent(config('app.name').' ('.config('app.url').')')
                ->acceptJson()
                ->get((string) config('services.places.url'), [
                    'q' => $query,
                    'format' => 'jsonv2',
                    'addressdetails' => 1,
                    'limit' => self::LIMIT,
                ]);
        } catch (\Throwable $failure) {
            Log::warning('Address lookup could not be reached.', [
                'message' => $failure->getMessage(),
            ]);

            return null;
        }

        if ($response->failed()) {
            Log::warning('Address lookup refused.', ['status' => $response->status()]);

            return null;
        }

        $results = $response->json();

        if (! is_array($results)) {
            return null;
        }

        $places = [];

        foreach ($results as $result) {
            $place = $this->place(is_array($result) ? $result : []);

            if ($place !== null) {
                $places[] = $place;
            }
        }

        return $places;
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array{label: string, latitude: float, longitude: float, region: string|null}|null
     */
    private function place(array $result): ?array
    {
        $label = $result['display_name'] ?? null;

        if (! is_string($label) || ! is_numeric($result['lat'] ?? null) || ! is_numeric($result['lon'] ?? null)) {
            return null;
        }

        return [
            'label' => $label,
            'latitude' => round((float) $result['lat'], 6),
            'longitude' => round((float) $result['lon'], 6),
            // The jurisdiction, in the sense the code requirements mean it —
            // city, province, country — so siting a building also settles
            // which code its walls answer to.
            'region' => $this->region(
                is_array($result['address'] ?? null) ? $result['address'] : [],
            ),
        ];
    }

    /**
     * @param  array<string, mixed>  $address
     */
    private function region(array $address): ?string
    {
        $parts = array_values(array_filter([
            $address['city'] ?? $address['town'] ?? $address['village'] ?? $address['municipality'] ?? null,
            $address['state'] ?? $address['province'] ?? null,
            $address['country'] ?? null,
        ], is_string(...)));

        return $parts === [] ? null : implode(', ', $parts);
    }
}
