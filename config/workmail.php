<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Who May Sign In
    |--------------------------------------------------------------------------
    |
    | Vanhaven is Van Haven's own studio software, so an account belongs to the
    | practice: only these domains may register or sign in. Everything else is
    | refused at the door, whichever door it tries.
    |
    | Add a domain by listing it here or in WORK_EMAIL_DOMAINS. Sub-domains
    | count, so `vanhaven.ca` also admits `someone@studio.vanhaven.ca`.
    |
    | Turn the whole thing off with WORK_EMAIL_ONLY=false.
    |
    */

    'enabled' => (bool) env('WORK_EMAIL_ONLY', true),

    'domains' => array_values(array_filter(array_map(
        fn (string $domain): string => mb_strtolower(trim($domain, " \t\n\r\0\x0B.@")),
        explode(',', (string) env('WORK_EMAIL_DOMAINS', 'vanhaven.ca,example.com')),
    ))),

    /*
    | Individual addresses welcome whatever their domain — a founder's own
    | account, a consultant, a demo login. Compared lower-cased, in full.
    |
    | WORK_EMAIL_ALLOWED="shane@vdkgroup.com,someone@gmail.com"
    */

    'allowed' => array_values(array_filter(array_map(
        fn (string $address): string => mb_strtolower(trim($address)),
        explode(',', (string) env('WORK_EMAIL_ALLOWED', '')),
    ))),

];
