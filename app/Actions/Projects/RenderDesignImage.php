<?php

namespace App\Actions\Projects;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Turns a written brief into a photograph of the design.
 *
 * Pollinations serves image generation free and without an API key, which is
 * the whole reason it was chosen: nothing to sign up for and nothing to bill.
 * The prompt is composed in the browser from the model's own measurements, so
 * this action only carries it across the wire.
 */
class RenderDesignImage
{
    /**
     * The longest a prompt may be before the URL becomes unreasonable.
     */
    public const PROMPT_LIMIT = 1400;

    /**
     * Render the brief, returning a PNG-or-JPEG data URL.
     *
     * @throws RuntimeException when the generator is unreachable or unhelpful
     */
    public function handle(string $prompt, int $width, int $height, int $seed): string
    {
        $response = Http::timeout((int) config('services.pollinations.timeout'))
            ->withHeaders(['Accept' => 'image/*'])
            ->get($this->endpoint($prompt), [
                'width' => $width,
                'height' => $height,
                'seed' => $seed,
                'model' => config('services.pollinations.model'),
                // The generator otherwise burns a corner of the frame on its mark.
                'nologo' => 'true',
                'referrer' => config('app.url'),
            ]);

        if ($response->failed()) {
            Log::warning('The image generator refused the request.', [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 500),
            ]);

            throw new RuntimeException($this->reasonFor($response->status()));
        }

        $body = $response->body();
        $type = $response->header('Content-Type');

        if ($body === '' || ! str_starts_with((string) $type, 'image/')) {
            throw new RuntimeException('The generator sent something that was not an image. Try again.');
        }

        return 'data:'.$type.';base64,'.base64_encode($body);
    }

    /**
     * Pollinations takes the prompt in the path rather than the query string.
     */
    private function endpoint(string $prompt): string
    {
        $trimmed = mb_substr(trim($prompt), 0, self::PROMPT_LIMIT);

        return rtrim((string) config('services.pollinations.url'), '/')
            .'/prompt/'.rawurlencode($trimmed);
    }

    /**
     * Turn an upstream status into something worth showing a person.
     */
    private function reasonFor(int $status): string
    {
        return match ($status) {
            402, 401, 403 => 'The free image generator is asking for an account for this request. Try a shorter prompt.',
            429 => 'The free image generator is busy right now. Wait a moment and render again.',
            default => 'The image generator could not be reached. Try again in a moment.',
        };
    }
}
