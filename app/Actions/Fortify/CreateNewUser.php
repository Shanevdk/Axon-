<?php

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Concerns\ProfileValidationRules;
use App\Models\OrganizationInvitation;
use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules, ProfileValidationRules;

    /**
     * Validate and create a newly registered user.
     *
     * @param  array<string, string>  $input
     */
    public function create(array $input): User
    {
        Validator::make($input, [
            ...$this->profileRules(),
            'password' => $this->passwordRules(),
        ])->validate();

        $user = User::create([
            'name' => $input['name'],
            'email' => $input['email'],
            'password' => $input['password'],
        ]);

        $this->claimInvitation($user);

        return $user;
    }

    /**
     * Finish an invitation the visitor followed before they had an account, so
     * signing up drops them straight into the studio that asked for them.
     */
    private function claimInvitation(User $user): void
    {
        $token = session('invitation.token');

        if (! is_string($token)) {
            return;
        }

        session()->forget('invitation');

        $invitation = OrganizationInvitation::query()->where('token', $token)->first();

        if ($invitation?->isPending()) {
            $invitation->claim($user);
        }
    }
}
