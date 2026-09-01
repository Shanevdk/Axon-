<?php

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Validation\Rules\Password;

/* ------------------------------------------------------------- making one */

test('one line with no arguments opens the admin account', function () {
    // Nothing is typed on a deployment's command bar, so every value has to
    // have a default that is right.
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();

    expect($admin)->not->toBeNull()
        ->and($admin->name)->toBe('Admin')
        ->and($admin->email_verified_at)->not->toBeNull()
        ->and(Hash::check('1234567890', $admin->password))->toBeTrue();
});

test('the admin is put at the head of a studio', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();
    $studio = Organization::query()->where('owner_id', $admin->id)->first();

    expect($studio)->not->toBeNull()
        ->and($studio->name)->toBe('Van Haven')
        ->and($admin->organization_id)->toBe($studio->id)
        ->and($studio->join_code)->not->toBeEmpty();
});

test('running it again resets the password rather than failing', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();
    $this->artisan('vanhaven:admin', ['--password' => 'a-longer-one'])->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();

    // Being locked out of a deployment should not mean opening the database.
    expect(User::query()->where('email', 'admin@vanhaven.ca')->count())->toBe(1)
        ->and(Hash::check('a-longer-one', $admin->password))->toBeTrue();
});

test('a second run does not hand the admin a second studio', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();
    $this->artisan('vanhaven:admin')->assertSuccessful();

    expect(Organization::query()->count())->toBe(1);
});

test('an address that could never sign in is refused outright', function () {
    // Creating an account EnsureWorkEmail will turn away is worse than
    // creating none: the account looks fine and the door still says no.
    $this->artisan('vanhaven:admin', ['--email' => 'someone@gmail.com'])
        ->expectsOutputToContain('not a')
        ->assertFailed();

    expect(User::query()->where('email', 'someone@gmail.com')->exists())->toBeFalse();
});

test('a weak password is allowed but said out loud', function () {
    // The app only imposes the strict rule in production, which is exactly
    // where this command gets run, so that is the rule worth testing under.
    Password::defaults(fn (): Password => Password::min(12)->mixedCase()->numbers());

    $this->artisan('vanhaven:admin')
        ->expectsOutputToContain('would be refused at every other door')
        ->assertSuccessful();

    // Said, not refused: a known simple password for a first sign-in is a
    // fair choice, so long as nobody makes it by accident.
    expect(User::query()->where('email', 'admin@vanhaven.ca')->exists())->toBeTrue();
});

/* ------------------------------------------------------------ removing one */

test('an admin with nothing to lose is deleted', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();
    $this->artisan('vanhaven:admin-delete')->assertSuccessful();

    expect(User::query()->where('email', 'admin@vanhaven.ca')->exists())->toBeFalse();
});

test('deleting an account that is already gone is not a failure', function () {
    // A deploy step that tidies up a demo account should not go red because
    // there was nothing left to tidy.
    $this->artisan('vanhaven:admin-delete')->assertSuccessful();
});

test('it refuses when drawings would go with the account', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();
    Project::factory()->for($admin)->count(3)->create();

    // projects.user_id cascades, so this delete is silently a delete of every
    // drawing the account authored.
    $this->artisan('vanhaven:admin-delete')
        ->expectsOutputToContain('3 projects')
        ->assertFailed();

    expect(User::query()->where('email', 'admin@vanhaven.ca')->exists())->toBeTrue()
        ->and(Project::query()->count())->toBe(3);
});

test('it warns that deleting the owner strands the rest of the studio', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();
    User::factory()->count(2)->create(['organization_id' => $admin->organization_id]);

    $this->artisan('vanhaven:admin-delete')
        ->expectsOutputToContain('2 other members')
        ->assertFailed();
});

test('force goes ahead, and the cascade is real', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();
    $colleague = User::factory()->create(['organization_id' => $admin->organization_id]);
    Project::factory()->for($admin)->create();

    $this->artisan('vanhaven:admin-delete', ['--force' => true])->assertSuccessful();

    expect(User::query()->where('email', 'admin@vanhaven.ca')->exists())->toBeFalse()
        // Exactly what the refusal warned about, which is why it warns.
        ->and(Project::query()->count())->toBe(0)
        ->and(Organization::query()->count())->toBe(0)
        ->and($colleague->refresh()->organization_id)->toBeNull();
});

test('a colleague drawing is not touched by the admin being removed', function () {
    $this->artisan('vanhaven:admin')->assertSuccessful();

    $admin = User::query()->where('email', 'admin@vanhaven.ca')->first();
    $colleague = User::factory()->create(['organization_id' => $admin->organization_id]);
    $theirs = Project::factory()->for($colleague)->create();

    $this->artisan('vanhaven:admin-delete', ['--force' => true])->assertSuccessful();

    expect(Project::query()->find($theirs->id))->not->toBeNull();
});
