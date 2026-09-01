{{--
    Connecting Vanhaven to Claude.

    This is the only part of the OAuth flow anybody sees, and it is the moment
    they decide whether an AI client gets at their studio's drawings. So it
    says plainly what is being connected, as whom, and what it will be able to
    do — including the part people care about, which is that it can change the
    model and not only read it.

    Plain Blade rather than Inertia: it is opened in a popup by the client, is
    gone a second later, and has no business booting the app shell.
--}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">

    <title>Connect {{ $client->name }} — {{ config('app.name') }}</title>

    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600" rel="stylesheet" />

    @vite(['resources/css/app.css'])
</head>
<body class="min-h-screen bg-background font-sans text-foreground antialiased">
    <div class="flex min-h-screen items-center justify-center p-4">
        <div class="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-6 shadow-sm">
            <header class="space-y-2">
                <p class="ax-eyebrow text-[0.65rem] text-sand">{{ config('app.name') }}</p>

                <h1 class="text-xl font-semibold tracking-tight">
                    Let {{ $client->name }} work on your drawings?
                </h1>

                <p class="text-sm text-muted-foreground">
                    It is asking to connect to your studio in Vanhaven.
                </p>
            </header>

            <div class="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <p class="text-muted-foreground">Connecting as</p>
                <p class="font-medium">{{ $user->name }} &middot; {{ $user->email }}</p>
            </div>

            {{--
                Said in terms of buildings rather than tool names. "Use
                available MCP functionality" tells nobody anything, and this
                grant is not read-only — that is the part worth being blunt
                about before somebody clicks the button.
            --}}
            <div class="space-y-2 text-sm">
                <p class="font-medium">It will be able to:</p>

                <ul class="space-y-1.5 text-muted-foreground">
                    <li class="flex gap-2">
                        <span aria-hidden="true" class="text-sand">&bull;</span>
                        Read the projects and drawings your studio can see
                    </li>
                    <li class="flex gap-2">
                        <span aria-hidden="true" class="text-sand">&bull;</span>
                        Draw in them — walls, doors, windows, rooms and levels
                    </li>
                    <li class="flex gap-2">
                        <span aria-hidden="true" class="text-sand">&bull;</span>
                        Read and design items on your model library shelf
                    </li>
                </ul>

                <p class="pt-1 text-xs text-muted-foreground">
                    It cannot see another studio's work, and it cannot delete a
                    project or reach anything outside the drawings. Disconnect
                    it whenever you like from {{ $client->name }}.
                </p>
            </div>

            @if (! empty($scopes))
                <ul class="space-y-1 text-xs text-muted-foreground">
                    @foreach ($scopes as $scope)
                        <li>{{ $scope->description }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="flex gap-3 pt-1">
                <form method="POST" action="{{ route('passport.authorizations.deny') }}" class="flex-1">
                    @csrf
                    @method('DELETE')
                    <input type="hidden" name="auth_token" value="{{ $authToken }}">

                    <button type="submit"
                            class="h-10 w-full rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                        Not now
                    </button>
                </form>

                <form method="POST" action="{{ route('passport.authorizations.approve') }}" class="flex-1">
                    @csrf
                    <input type="hidden" name="auth_token" value="{{ $authToken }}">

                    <button type="submit"
                            class="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                        Connect
                    </button>
                </form>
            </div>
        </div>
    </div>
</body>
</html>
