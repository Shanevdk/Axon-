<?php

namespace App\Http\Middleware;

use App\Rules\WorkEmail;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Only the studio's own addresses get in.
 *
 * The validation rule guards the doors that set an address; this guards the
 * ones that open a session. There are several — password, passkey, the
 * two-factor challenge, a remembered cookie — and checking the signed-in
 * user rather than each of them means none can be forgotten. It also catches
 * an account whose address stopped qualifying after the fact, whether the
 * allowed domains changed or the account predates this rule.
 */
class EnsureWorkEmail
{
    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null || WorkEmail::passes($user->email)) {
            return $next($request);
        }

        auth()->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        $message = __('Vanhaven is for the studio: sign in with your :domain address. :email is not one.', [
            'domain' => implode(' or ', WorkEmail::domains()),
            'email' => $user->email,
        ]);

        if ($request->expectsJson()) {
            return response()->json(['message' => $message], 403);
        }

        return redirect()->route('login')->withErrors(['email' => $message]);
    }
}
