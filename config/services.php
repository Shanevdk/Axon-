<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    /*
    | Pollinations generates images free and without an API key, which is why
    | the render feature uses it — there is nothing to sign up for. It serves
    | one model today; the slug stays in config so it can change.
    */
    'pollinations' => [
        'url' => env('POLLINATIONS_URL', 'https://image.pollinations.ai'),
        'model' => env('POLLINATIONS_MODEL', 'sana'),
        'timeout' => (int) env('POLLINATIONS_TIMEOUT', 120),
    ],

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    /*
    | OpenRouter fronts a catalogue of hosted models behind one OpenAI-shaped
    | endpoint. The default is one of its free tiers, so the assistant costs
    | nothing to run; swap OPENROUTER_MODEL for a paid slug at will.
    */
    'openrouter' => [
        'key' => env('OPENROUTER_API_KEY'),
        'model' => env('OPENROUTER_MODEL', 'nvidia/nemotron-3-super-120b-a12b:free'),
        'url' => env('OPENROUTER_URL', 'https://openrouter.ai/api/v1'),
        'timeout' => (int) env('OPENROUTER_TIMEOUT', 60),
    ],

    /*
    |----------------------------------------------------------------------
    | Ground levels
    |----------------------------------------------------------------------
    |
    | Where the height of the land comes from. Open-Meteo serves elevation
    | free and without a key, reading a global 30m digital terrain model.
    |
    | Thirty metres between samples and a few metres of vertical error is a
    | shape, not a survey: good enough to site a house on a slope and to
    | draw ground on an elevation, nowhere near good enough to set a footing.
    | `SITE_GROUND_LABEL` is written onto the drawing so nobody has to guess
    | which of the two they are looking at.
    */
    'ground' => [
        'url' => env('SITE_GROUND_URL', 'https://api.open-meteo.com/v1/elevation'),
        'label' => env('SITE_GROUND_LABEL', 'Open-Meteo 30m terrain model'),
        'timeout' => (int) env('SITE_GROUND_TIMEOUT', 20),
    ],

    /*
     * Claude Code on this machine, driven headlessly so the item designer's
     * terminal answers in the page.
     *
     * This is what lets a Claude subscription design furniture: the CLI is
     * already signed in, so nothing here bills an API account. It runs a
     * local binary, so it is only enabled where that is the user's own
     * computer — set CLAUDE_CODE_ENABLED explicitly to allow it elsewhere.
     */
    'claude_code' => [
        'binary' => env('CLAUDE_CODE_BINARY', 'claude'),
        'enabled' => env('CLAUDE_CODE_ENABLED'),
        'timeout' => (int) env('CLAUDE_CODE_TIMEOUT', 180),
        /*
         * The PHP that starts our MCP server for a sidebar turn. Left empty
         * it is worked out, which is right nearly everywhere; set it when the
         * CLI does not sit beside whatever is serving the app.
         */
        'php' => env('CLAUDE_CODE_PHP', ''),
    ],

    /*
     * Base URLs for the providers a user can connect their own AI account
     * from. Configurable so the tests can point them at fakes; the keys
     * themselves live per user, encrypted, in ai_connections.
     */
    'anthropic' => [
        'url' => env('ANTHROPIC_URL', 'https://api.anthropic.com'),
        'version' => '2023-06-01',
        'timeout' => (int) env('ANTHROPIC_TIMEOUT', 60),
    ],

    'openai' => [
        'url' => env('OPENAI_URL', 'https://api.openai.com'),
        'timeout' => (int) env('OPENAI_TIMEOUT', 60),
    ],

    /*
     * Turns the browser's coordinates into a place name, so the code
     * assistant can be told where a building is without anyone typing it.
     * Free and keyless, and only ever sent a rounded latitude and longitude.
     */
    /*
    |----------------------------------------------------------------------
    | Finding a site
    |----------------------------------------------------------------------
    |
    | Turning a typed address into a place on the earth, and drawing the map
    | it is picked on. Both are OpenStreetMap and both are free and keyless.
    |
    | Nominatim asks for a User-Agent that identifies the application and no
    | more than one request a second; answers are cached for a month, since
    | an address does not move. The tile server asks for attribution, which
    | the picker shows. A studio doing enough of either to be noticed should
    | point these at its own provider rather than lean on the free ones.
    */
    'places' => [
        'url' => env('PLACES_URL', 'https://nominatim.openstreetmap.org/search'),
        'timeout' => (int) env('PLACES_TIMEOUT', 15),
        'tiles' => env(
            'MAP_TILES_URL',
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ),
        'attribution' => env('MAP_ATTRIBUTION', '© OpenStreetMap contributors'),
    ],

    'geocoder' => [
        'url' => env(
            'GEOCODER_URL',
            'https://api.bigdatacloud.net/data/reverse-geocode-client',
        ),
        'timeout' => (int) env('GEOCODER_TIMEOUT', 10),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
