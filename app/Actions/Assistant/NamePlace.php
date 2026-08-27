<?php

namespace App\Actions\Assistant;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Turns a pair of coordinates into the name of a place.
 *
 * The code assistant needs to know which jurisdiction a building sits in, and
 * "share my location" is a great deal less work than typing it. Only the
 * jurisdiction comes back — city, region, country — never a street address.
 */
class NamePlace
{
    /**
     * Coordinates are rounded before they leave, both to keep the request
     * coarse and so nearby lookups share a cache entry. Three decimals is
     * about a hundred metres, which is far finer than any code boundary.
     */
    private const PRECISION = 3;

    /**
     * A place name does not change, so this is only really about not calling
     * a free service repeatedly while somebody fiddles with the dialog.
     */
    private const CACHE_DAYS = 30;

    /**
     * Name the jurisdiction at these coordinates.
     *
     * @throws RuntimeException when the lookup fails or names nowhere
     */
    public function handle(float $latitude, float $longitude): string
    {
        $latitude = round($latitude, self::PRECISION);
        $longitude = round($longitude, self::PRECISION);

        $place = Cache::remember(
            "place:{$latitude},{$longitude}",
            now()->addDays(self::CACHE_DAYS),
            fn (): ?string => $this->lookUp($latitude, $longitude),
        );

        if ($place === null) {
            // Nothing worth keeping, so do not let the miss stick around.
            Cache::forget("place:{$latitude},{$longitude}");

            throw new RuntimeException(
                'Could not work out where that is. Type the city and country instead.'
            );
        }

        return $place;
    }

    /**
     * Ask the geocoder, returning null when it cannot say.
     */
    private function lookUp(float $latitude, float $longitude): ?string
    {
        $response = Http::timeout((int) config('services.geocoder.timeout'))
            ->get((string) config('services.geocoder.url'), [
                'latitude' => $latitude,
                'longitude' => $longitude,
                'localityLanguage' => 'en',
            ]);

        if ($response->failed()) {
            Log::warning('The geocoder refused a lookup.', [
                'status' => $response->status(),
            ]);

            return null;
        }

        return $this->compose($response->json());
    }

    /**
     * Read the city, region and country out of the reply.
     *
     * The locality is preferred over the city because it is the one that
     * names an unincorporated area rather than the nearest large town.
     *
     * @param  mixed  $body
     */
    private function compose($body): ?string
    {
        $parts = array_filter([
            data_get($body, 'city') ?: data_get($body, 'locality'),
            data_get($body, 'principalSubdivision'),
            data_get($body, 'countryName'),
        ], fn ($part): bool => is_string($part) && trim($part) !== '');

        $place = implode(', ', array_unique(array_map('trim', $parts)));

        return $place === '' ? null : $place;
    }
}
