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
