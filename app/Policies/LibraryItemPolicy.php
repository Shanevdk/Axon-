<?php

namespace App\Policies;

use App\Models\LibraryItem;
use App\Models\User;

class LibraryItemPolicy
{
    /**
     * Determine whether the user can view the item.
     */
    public function view(User $user, LibraryItem $libraryItem): bool
    {
        return $this->sameTeam($user, $libraryItem);
    }

    /**
     * Determine whether the user can update the item.
     */
    public function update(User $user, LibraryItem $libraryItem): bool
    {
        return $this->sameTeam($user, $libraryItem);
    }

    /**
     * Determine whether the user can delete the item.
     */
    public function delete(User $user, LibraryItem $libraryItem): bool
    {
        return $this->sameTeam($user, $libraryItem);
    }

    /**
     * The library is the studio's: whoever saved an item and everyone in
     * that person's organization.
     */
    private function sameTeam(User $user, LibraryItem $libraryItem): bool
    {
        if ($user->id === $libraryItem->user_id) {
            return true;
        }

        if ($user->organization_id === null) {
            return false;
        }

        return $libraryItem->user?->organization_id === $user->organization_id;
    }
}
