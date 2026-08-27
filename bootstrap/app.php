<?php

use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\RecordPresence;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Laravel Cloud terminates TLS at its load balancer and forwards over
        // plain HTTP. Without this the app believes it is on http://, and the
        // invitation links it mails out would be built on the wrong scheme.
        // The balancer's addresses are not fixed, hence the wildcard.
        $middleware->trustProxies(at: '*');

        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
            RecordPresence::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        /*
         * A record that has gone should not be a dead end.
         *
         * Signing in sends people to whatever URL bounced them to the login
         * screen, so a drawing deleted in the meantime — or a database that
         * has been rebuilt underneath them — lands a signed-in user on a bare
         * 404 the moment they arrive. Send them to the register instead, and
         * say what happened.
         */
        $exceptions->render(function (NotFoundHttpException $exception, Request $request) {
            $missing = $exception->getPrevious();

            if (! $missing instanceof ModelNotFoundException || $request->user() === null) {
                return null;
            }

            $index = match (class_basename($missing->getModel())) {
                'Project' => ['projects.index', __('That drawing no longer exists.')],
                'Client' => ['clients.index', __('That client no longer exists.')],
                default => null,
            };

            if ($index === null || $request->expectsJson()) {
                return null;
            }

            [$route, $message] = $index;

            Inertia::flash('toast', ['type' => 'error', 'message' => $message]);

            return redirect()->route($route);
        });
    })->create();
