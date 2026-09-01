<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * Where someone goes once they are through the door.
 *
 * The first arrival lands on the front page, which is the only place Vanhaven
 * explains itself; every arrival after that skips the sales pitch and opens
 * the studio. An intended URL still wins — somebody following an invitation
 * link should end up where the link pointed.
 */
trait SendsUserHome
{
    private function sendHome(Request $request): RedirectResponse|JsonResponse
    {
        $isFirstVisit = $request->user()->recordSignIn();

        if ($request->wantsJson()) {
            return new JsonResponse('', 204);
        }

        return redirect()->intended(
            $isFirstVisit ? route('home') : config('fortify.home'),
        );
    }
}
