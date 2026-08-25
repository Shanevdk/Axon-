<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;

class ProjectPolicy
{
    /**
     * Determine whether the user can view the project.
     */
    public function view(User $user, Project $project): bool
    {
        return $this->sameTeam($user, $project);
    }

    /**
     * Determine whether the user can update the project.
     */
    public function update(User $user, Project $project): bool
    {
        return $this->sameTeam($user, $project);
    }

    /**
     * Determine whether the user can delete the project.
     */
    public function delete(User $user, Project $project): bool
    {
        return $this->sameTeam($user, $project);
    }

    /**
     * A project is open to its author and to everyone in the author's
     * organization — joining the team is joining the work.
     */
    private function sameTeam(User $user, Project $project): bool
    {
        if ($user->id === $project->user_id) {
            return true;
        }

        if ($user->organization_id === null) {
            return false;
        }

        return $project->user?->organization_id === $user->organization_id;
    }
}
