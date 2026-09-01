<?php

use App\Models\Organization;
use App\Models\User;
use App\Rules\WorkEmail;
use Database\Seeders\DatabaseSeeder;

beforeEach(function () {
    config()->set('workmail.enabled', true);
    config()->set('workmail.domains', ['vanhaven.ca', 'example.com']);
    config()->set('workmail.allowed', []);
});

/* ----------------------------------------------------------------- the rule */

test('only the studio\'s own domains are admitted', function (string $email, bool $allowed) {
    expect(WorkEmail::passes($email))->toBe($allowed);
})->with([
    ['shane@vanhaven.ca', true],
    ['SHANE@VanHaven.CA', true],
    ['example@example.com', true],
    // Sub-domains are still the practice.
    ['someone@studio.vanhaven.ca', true],

    // Another firm's address is not this firm's.
    ['shane@vdkgroup.com', false],
    ['a.person@some-architects.co.uk', false],
    ['someone@gmail.com', false],
    ['someone@outlook.com', false],
    // A domain that merely ends with the letters is somebody else entirely.
    ['someone@notvanhaven.ca', false],
    ['someone@vanhaven.ca.example.org', false],
]);

test('the rule stands aside for things that are not addresses', function () {
    // The `email` rule reports these far more usefully.
    expect(WorkEmail::passes(''))->toBeTrue()
        ->and(WorkEmail::passes('not-an-address'))->toBeTrue()
        ->and(WorkEmail::passes(null))->toBeTrue();
});

test('a named address is welcome whatever its domain', function () {
    config()->set('workmail.allowed', ['shane@vdkgroup.com']);

    expect(WorkEmail::passes('shane@vdkgroup.com'))->toBeTrue()
        ->and(WorkEmail::passes('SHANE@VDKGROUP.COM'))->toBeTrue()
        ->and(WorkEmail::passes('someone.else@vdkgroup.com'))->toBeFalse();
});

test('turning the rule off lets everything through', function () {
    config()->set('workmail.enabled', false);

    expect(WorkEmail::passes('someone@gmail.com'))->toBeTrue();
});

test('the allowed domains are named out loud, for the message', function () {
    expect(WorkEmail::domains())->toBe(['@vanhaven.ca', '@example.com']);
});

/* --------------------------------------------------------------- inviting in */

test('an address outside the studio cannot be invited, and says which to use', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'someone@gmail.com'])
        ->assertSessionHasErrors([
            'email' => 'Use your @vanhaven.ca or @example.com address.',
        ]);

    expect($organization->invitations()->count())->toBe(0);
});

test('a studio address is invited as before', function () {
    $organization = Organization::factory()->create();

    $this->actingAs($organization->owner)
        ->post(route('organization.invitations.store'), ['email' => 'margaret@vanhaven.ca'])
        ->assertSessionHasNoErrors();

    expect($organization->invitations()->sole()->email)->toBe('margaret@vanhaven.ca');
});

/* ------------------------------------------------------------ changing it */

test('an address outside the studio cannot be moved to in settings', function () {
    $user = User::factory()->create(['email' => 'margaret@vanhaven.ca']);

    $this->actingAs($user)
        ->patch(route('profile.update'), [
            'name' => $user->name,
            'email' => 'margaret@gmail.com',
        ])
        ->assertSessionHasErrors('email');

    expect($user->fresh()->email)->toBe('margaret@vanhaven.ca');
});

/* -------------------------------------------------------------- inviting */

test('somebody outside the studio cannot be invited', function () {
    $organization = Organization::factory()->create();
    $head = User::factory()->for($organization)->create(['email' => 'head@vanhaven.ca']);
    $organization->forceFill(['owner_id' => $head->id])->save();

    $this->actingAs($head)
        ->post(route('organization.invitations.store'), ['email' => 'friend@gmail.com'])
        ->assertSessionHasErrors('email');

    expect($organization->invitations()->count())->toBe(0);
});

/* --------------------------------------------------------------- signing in */

test('an account from another domain is turned away from every page', function () {
    $stranded = User::factory()->create(['email' => 'someone@gmail.com']);

    $this->actingAs($stranded)
        ->get(route('dashboard'))
        ->assertRedirect(route('login'))
        ->assertSessionHasErrors('email');

    // And the session is gone, not merely bounced.
    expect(auth()->check())->toBeFalse();
});

test('a studio account is untouched', function () {
    $user = User::factory()->create(['email' => 'margaret@vanhaven.ca']);

    $this->actingAs($user)->get(route('dashboard'))->assertOk();
});

test('a named address still signs in', function () {
    config()->set('workmail.allowed', ['shane@vdkgroup.com']);

    $founder = User::factory()->create(['email' => 'shane@vdkgroup.com']);

    $this->actingAs($founder)->get(route('dashboard'))->assertOk();
});

test('a JSON caller is told in JSON rather than redirected', function () {
    $stranded = User::factory()->create(['email' => 'someone@gmail.com']);

    $this->actingAs($stranded)
        ->getJson(route('library.feed'))
        ->assertStatus(403)
        ->assertJsonPath(
            'message',
            fn (string $message): bool => str_contains($message, '@vanhaven.ca'),
        );
});

test('guests are left to the ordinary auth middleware', function () {
    $this->get(route('dashboard'))->assertRedirect(route('login'));
});

/* ------------------------------------------------------------ the example */

test('the seeded example account signs in with its simple password', function () {
    $this->seed(DatabaseSeeder::class);

    $this->post(route('login.store'), [
        'email' => 'example@example.com',
        'password' => '1234567890',
    ])->assertSessionHasNoErrors();

    expect(auth()->check())->toBeTrue()
        ->and(auth()->user()->email)->toBe('example@example.com');
});

/* ------------------------------------------------- what a terminal smuggles */

test('an address survives whatever a terminal or a paste adds to it', function (string $raw) {
    expect(WorkEmail::passes($raw))->toBeTrue()
        ->and(WorkEmail::normalise($raw))->toBe('pieter@vanhaven.ca');
})->with([
    'plain' => ['pieter@vanhaven.ca'],
    'shouted' => ['PIETER@VanHaven.CA'],
    'padded' => ['  pieter@vanhaven.ca  '],
    // trim() knows none of these, and each one broke the domain match.
    'no-break space' => ["pieter@vanhaven.ca\u{00A0}"],
    'zero-width space' => ["pieter@vanhaven.ca\u{200B}"],
    'stray escape' => ["pieter@vanhaven.ca\x1b"],
    'byte-order mark' => ["\u{FEFF}pieter@vanhaven.ca"],
    'carriage return' => ["pieter@vanhaven.ca\r\n"],
    'space in the middle' => ['pieter @vanhaven.ca'],
]);

test('normalising leaves an ordinary address alone', function () {
    expect(WorkEmail::normalise('margaret@vanhaven.ca'))->toBe('margaret@vanhaven.ca')
        ->and(WorkEmail::normalise(null))->toBe('')
        ->and(WorkEmail::normalise(''))->toBe('');
});
