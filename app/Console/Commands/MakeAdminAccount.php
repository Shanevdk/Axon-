<?php

namespace App\Console\Commands;

use App\Models\Organization;
use App\Models\User;
use App\Rules\WorkEmail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password as askPassword;
use function Laravel\Prompts\text;

class MakeAdminAccount extends Command
{
    protected $signature = 'axon:admin
        {--email= : The address the account signs in with}
        {--name= : Who they are}
        {--password= : Set it here to run without prompts, on a deploy}
        {--studio= : Name of the studio to create and put them in charge of}';

    protected $description = 'Open the first account, and put it in charge of a studio';

    /**
     * Nobody can sign themselves up, so the first account has to be made from
     * a terminal. After this one exists it invites everybody else from the
     * Organization page.
     */
    public function handle(): int
    {
        $email = WorkEmail::normalise(
            $this->option('email') ?? text('Email address', required: true),
        );

        $name = trim($this->option('name') ?? text('Name', required: true));

        if (User::query()->where('email', $email)->exists()) {
            $this->components->error("An account already uses {$email}.");

            return self::FAILURE;
        }

        if (! WorkEmail::passes($email)) {
            // The address is quoted back, so a mismatch nobody can see is at
            // least a mismatch nobody has to guess at.
            $this->components->error(sprintf(
                '"%s" is not a %s address. Change WORK_EMAIL_DOMAINS, or list it in WORK_EMAIL_ALLOWED.',
                $email,
                implode(' or ', WorkEmail::domains()),
            ));

            return self::FAILURE;
        }

        $password = $this->option('password') ?? askPassword('Password', required: true);

        $check = Validator::make(
            ['password' => $password],
            ['password' => ['required', 'string', Password::default()]],
        );

        if ($check->fails()) {
            $this->components->error($check->errors()->first('password'));

            return self::FAILURE;
        }

        $studio = trim(
            $this->option('studio') ?? text('Studio name', default: 'Van Haven'),
        );

        // Account and studio together, or neither: a half-made admin with no
        // studio is worse than no admin, because the address is then taken.
        $organization = DB::transaction(function () use ($email, $name, $password, $studio): ?Organization {
            $user = User::create([
                'name' => $name,
                'email' => $email,
                'password' => $password,
            ]);

            // Made by hand at a terminal, so there is nobody to verify it to.
            $user->forceFill(['email_verified_at' => now()])->save();

            if ($studio === '') {
                return null;
            }

            $organization = new Organization(['name' => $studio]);

            // Ownership and the code are forced rather than mass assigned,
            // the same way OrganizationController::store does it.
            $organization->forceFill([
                'owner_id' => $user->id,
                'join_code' => Organization::generateJoinCode(),
            ])->save();

            $user->organization()->associate($organization)->save();

            return $organization;
        });

        if ($organization !== null) {
            $this->components->info(
                "{$studio} created, with {$name} at its head. Join code {$organization->join_code}."
            );
        }

        $this->components->info("{$email} can sign in now.");
        $this->components->bulletList([
            'Open the Organization page to invite the rest of the studio.',
            'Everyone else joins through the link they are emailed.',
        ]);

        return self::SUCCESS;
    }
}
