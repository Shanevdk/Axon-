<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\View;
use Symfony\Component\HttpFoundation\Response;

class HandleAppearance
{
    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        View::share('appearance', $request->cookie('appearance') ?? 'system');

        // Painted onto <html> in the shell so the palette never flashes.
        $palette = $request->cookie('palette');

        View::share('palette', in_array($palette, ['graphite', 'blueprint', 'sand', 'mono'], true)
            ? $palette
            : 'graphite');

        return $next($request);
    }
}
