<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;

class RegisterResponse implements RegisterResponseContract
{
    use SendsUserHome;

    /**
     * Registering is by definition a first arrival, so this lands on the
     * front page — which reads as a welcome once you are signed in.
     */
    public function toResponse($request): RedirectResponse|JsonResponse
    {
        /** @var Request $request */
        return $this->sendHome($request);
    }
}
