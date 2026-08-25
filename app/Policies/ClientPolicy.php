<?php

namespace App\Policies;

use App\Models\Client;
use App\Models\User;

class ClientPolicy
{
    /**
     * Determine whether the user can view the client.
     */
    public function view(User $user, Client $client): bool
    {
        return $this->sameTeam($user, $client);
    }

    /**
     * Determine whether the user can update the client.
     */
    public function update(User $user, Client $client): bool
    {
        return $this->sameTeam($user, $client);
    }

    /**
     * Determine whether the user can delete the client.
     */
    public function delete(User $user, Client $client): bool
    {
        return $this->sameTeam($user, $client);
    }

    /**
     * A client is visible to whoever keeps them and to everyone in that
     * person's organization.
     */
    private function sameTeam(User $user, Client $client): bool
    {
        if ($user->id === $client->user_id) {
            return true;
        }

        if ($user->organization_id === null) {
            return false;
        }

        return $client->user?->organization_id === $user->organization_id;
    }
}
