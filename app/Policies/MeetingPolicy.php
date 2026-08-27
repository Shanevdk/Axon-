<?php

namespace App\Policies;

use App\Models\Meeting;
use App\Models\User;

class MeetingPolicy
{
    /**
     * Determine whether the user can view the meeting.
     */
    public function view(User $user, Meeting $meeting): bool
    {
        return $this->sameTeam($user, $meeting);
    }

    /**
     * Determine whether the user can update the meeting.
     */
    public function update(User $user, Meeting $meeting): bool
    {
        return $this->sameTeam($user, $meeting);
    }

    /**
     * Determine whether the user can delete the meeting.
     */
    public function delete(User $user, Meeting $meeting): bool
    {
        return $this->sameTeam($user, $meeting);
    }

    /**
     * The diary is shared: whoever booked the meeting and everyone else in
     * their organization can move or cancel it.
     */
    private function sameTeam(User $user, Meeting $meeting): bool
    {
        if ($user->id === $meeting->user_id) {
            return true;
        }

        if ($user->organization_id === null) {
            return false;
        }

        return $meeting->user?->organization_id === $user->organization_id;
    }
}
