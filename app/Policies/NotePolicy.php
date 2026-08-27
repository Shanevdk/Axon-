<?php

namespace App\Policies;

use App\Models\Note;
use App\Models\User;

class NotePolicy
{
    /**
     * Determine whether the user can view the note.
     */
    public function view(User $user, Note $note): bool
    {
        return $this->sameTeam($user, $note);
    }

    /**
     * Determine whether the user can update the note.
     */
    public function update(User $user, Note $note): bool
    {
        return $this->sameTeam($user, $note);
    }

    /**
     * Determine whether the user can delete the note.
     */
    public function delete(User $user, Note $note): bool
    {
        return $this->sameTeam($user, $note);
    }

    /**
     * A note belongs to the studio notebook: whoever wrote it and everyone
     * else in their organization.
     */
    private function sameTeam(User $user, Note $note): bool
    {
        if ($user->id === $note->user_id) {
            return true;
        }

        if ($user->organization_id === null) {
            return false;
        }

        return $note->user?->organization_id === $user->organization_id;
    }
}
