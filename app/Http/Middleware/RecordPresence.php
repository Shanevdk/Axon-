<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every authenticated request is the presence heartbeat: browsing the studio,
 * polling the chat or autosaving a drawing all count as being at the desk.
 * The model throttles the actual write to once a minute.
 */
class RecordPresence
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $request->user()?->recordActivity();

        return $next($request);
    }
}
