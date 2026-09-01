<?php

namespace App\Http\Middleware;

use App\Models\Client;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The door to the client portal.
 *
 * Clients are not users — they have no account, no password and no place in
 * the studio's auth guard. They hold a number, and exchanging it for a
 * session is the whole of signing in. This resolves that session back into a
 * client on every request and turns away anyone without one.
 */
class EnsureClientSignedIn
{
    /**
     * The session key holding the signed-in client's id.
     */
    public const SESSION_KEY = 'portal_client_id';

    /**
     * The request attribute the controller reads the client back out of.
     */
    public const REQUEST_KEY = 'portal_client';

    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $client = Client::query()->find($request->session()->get(self::SESSION_KEY));

        // A removed client keeps a valid session cookie until it is cleared,
        // so the record is looked up every time rather than trusted.
        if ($client === null) {
            $request->session()->forget(self::SESSION_KEY);

            return redirect()->route('portal.enter');
        }

        $request->attributes->set(self::REQUEST_KEY, $client);

        return $next($request);
    }
}
