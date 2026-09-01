<?php

namespace App\Console\Commands;

use App\Models\Message;
use App\Models\Organization;
use App\Models\User;
use App\Rules\WorkEmail;
use Illuminate\Console\Command;

class DeleteVanhavenAdmin extends Command
{
    protected $signature = 'vanhaven:admin-delete
        {--email=admin@vanhaven.ca : The account to remove}
        {--force : Delete it even though other things go with it}';

    protected $description = 'Remove the admin account';

    /**
     * Deleting an account is not only deleting an account.
     *
     * Every table that belongs to a user cascades: projects, clients, notes,
     * meetings, library items, messages. And a studio cascades from its
     * owner, so removing the founder deletes the organization and sets every
     * remaining member's `organization_id` to null — they keep their accounts
     * and silently stop being able to see each other's work.
     *
     * None of that is visible from the command line, so this counts it first
     * and stops. `--force` goes ahead, having said what it is taking.
     */
    public function handle(): int
    {
        $email = WorkEmail::normalise((string) $this->option('email'));

        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->components->warn("No account uses {$email}. Nothing to delete.");

            // Not a failure: a deploy step that removes a demo account should
            // not go red because it was already gone.
            return self::SUCCESS;
        }

        $losses = $this->whatGoesWithIt($user);

        if ($losses !== [] && ! $this->option('force')) {
            $this->components->error("Deleting {$email} would also delete:");
            $this->components->bulletList($losses);
            $this->components->warn('Nothing has been deleted. Run again with --force if that is what you want.');

            return self::FAILURE;
        }

        if ($losses !== []) {
            $this->components->warn('Deleting, and taking with it:');
            $this->components->bulletList($losses);
        }

        $user->delete();

        $this->components->info("{$email} deleted.");

        return self::SUCCESS;
    }

    /**
     * Everything the database would remove along with this account, in words.
     *
     * @return list<string>
     */
    private function whatGoesWithIt(User $user): array
    {
        $counts = [
            'project' => $user->projects()->count(),
            'client' => $user->clients()->count(),
            'note' => $user->notes()->count(),
            'meeting' => $user->meetings()->count(),
            'library item' => $user->libraryItems()->count(),
            'message' => Message::query()->where('user_id', $user->id)->count(),
        ];

        $losses = [];

        foreach ($counts as $noun => $many) {
            if ($many > 0) {
                $losses[] = $many.' '.($many === 1 ? $noun : $noun.'s');
            }
        }

        // The studio this account owns, which is not necessarily the one it
        // belongs to — only an owner's deletion takes an organization down.
        $studio = Organization::query()->where('owner_id', $user->id)->first();

        $others = $studio === null ? 0 : User::query()
            ->where('organization_id', $studio->id)
            ->whereKeyNot($user->id)
            ->count();

        // A studio with nobody else in it goes quietly — there is no one to
        // strand, and refusing there would mean the ordinary "make it, then
        // remove it" pair needed --force for no gain at all.
        if ($studio !== null && $others > 0) {
            $losses[] = sprintf(
                'the studio "%s" — its %d other %s would keep their accounts but lose the team, and with it sight of each other\'s drawings',
                $studio->name,
                $others,
                $others === 1 ? 'member' : 'members',
            );
        }

        return $losses;
    }
}
