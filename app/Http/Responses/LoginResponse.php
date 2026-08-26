<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;

class LoginResponse implements LoginResponseContract
{
    use SendsUserHome;

    /**
     * Send a returning user straight to the studio.
     */
    public function toResponse($request): RedirectResponse|JsonResponse
    {
        /** @var Request $request */
        return $this->sendHome($request);
    }
}
