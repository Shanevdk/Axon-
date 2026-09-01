<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Models\User;
use App\Rules\WorkEmail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class MakeVanhavenAdmin extends Command
{
    protected $signature = 'vanhaven:admin
        {--email=admin@vanhaven.ca : The address the account signs in with}
        {--name=Admin : Who they are}
        {--password=1234567890 : What they sign in with}
        {--studio=Van Haven : Studio to create and put them in charge of}';

    protected $description = 'Open (or reset) the admin account, ready to sign in';

    /**
     * The admin account, in one line and no questions.
     *
     * `axon:admin` is the careful version: it asks, and it holds the password
     * to the production policy. This one is for a deployment's command bar,
     * where there is nobody to answer a prompt — every value has a default,
     * so it runs as `php artisan vanhaven:admin` and nothing else.
     *
     * Running it twice is safe and is the point: the second run resets the
     * name and password of the account that is already there, which is how
     * somebody locked out gets back in without touching the database.
     */
    public function handle(): int
    {
        $email = WorkEmail::normalise((string) $this->option('email'));
        $name = trim((string) $this->option('name'));
        $password = (string) $this->option('password');
        $studio = trim((string) $this->option('studio'));

        if (! WorkEmail::passes($email)) {
            // Making an account that cannot sign in is worse than making none:
            // `EnsureWorkEmail` would turn it away at the door with no clue
            // that the account itself was fine.
            $this->components->error(sprintf(
                '"%s" is not a %s address, so it could be created but never signed in with. Change WORK_EMAIL_DOMAINS, or list it in WORK_EMAIL_ALLOWED.',
                $email,
                implode(' or ', WorkEmail::domains()),
            ));

            return self::FAILURE;
        }

        $existing = User::query()->where('email', $email)->first();

        $user = DB::transaction(function () use ($existing, $email, $name, $password, $studio): User {
            $user = $existing ?? new User;

            $user->forceFill([
                'name' => $name,
                'email' => $email,
                'password' => $password,
                // Made from a terminal, so there is nobody to verify it to.
                'email_verified_at' => $user->email_verified_at ?? now(),
            ])->save();

            $this->putInChargeOfAStudio($user, $studio);

            return $user;
        });

        $this->components->info(sprintf(
            '%s %s. Sign in with %s',
            $email,
            $existing === null ? 'created' : 'reset',
            $password,
        ));

        $this->reportWeakness($password);

        $organization = $user->fresh()?->organization;

        if ($organization !== null) {
            $this->components->info(sprintf(
                '%s, join code %s.',
                $organization->name,
                $organization->join_code,
            ));
        }

        return self::SUCCESS;
    }

    /**
     * Give the account a studio, unless it already has one.
     *
     * Never a second studio on a re-run: that would quietly move the admin
     * away from the team whose drawings they can see.
     */
    private function putInChargeOfAStudio(User $user, string $studio): void
    {
        if ($studio === '' || $user->organization_id !== null) {
            return;
        }

        $organization = new Organization(['name' => $studio]);

        // Ownership and the code are forced rather than mass assigned, the
        // same way OrganizationController::store does it.
        $organization->forceFill([
            'owner_id' => $user->id,
            'join_code' => Organization::generateJoinCode(),
        ])->save();

        $user->organization()->associate($organization)->save();
    }

    /**
     * Say so when the password would not be allowed anywhere else.
     *
     * Not a refusal — a known simple password is often exactly what is wanted
     * for a first sign-in. But this account can see every drawing the studio
     * has, so the risk is said out loud rather than left to be noticed.
     */
    private function reportWeakness(string $password): void
    {
        $check = Validator::make(
            ['password' => $password],
            ['password' => ['required', 'string', Password::default()]],
        );

        if ($check->passes()) {
            return;
        }

        $this->components->warn(
            'That password would be refused at every other door in the app: '
            .lcfirst($check->errors()->first('password'))
        );

        if (app()->isProduction()) {
            $this->components->warn(
                'This is a production deployment and the account can see every drawing in the studio. Change it from Settings once you are in.'
            );
        }
    }
}
