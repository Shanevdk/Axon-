<?php

use App\Models\User;
use Illuminate\Support\Facades\RateLimiter;
use Inertia\Testing\AssertableInertia;
use Laravel\Fortify\Features;

test('login screen can be rendered', function () {
    $response = $this->get(route('login'));

    $response->assertOk();
});

test('a first sign in lands on the front page', function () {
    $user = User::factory()->create(['signed_in_at' => null]);

    $response = $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'password',
    ]);

    $this->assertAuthenticated();
    $response->assertRedirect(route('home', absolute: false));

    expect($user->refresh()->signed_in_at)->not->toBeNull();
});

test('every sign in after the first goes straight to the studio', function () {
    $user = User::factory()->create(['signed_in_at' => now()->subWeek()]);

    $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'password',
    ])->assertRedirect(route('dashboard', absolute: false));
});

test('an intended destination still wins over both', function () {
    $user = User::factory()->create(['signed_in_at' => null]);

    // Bounced off a protected page, so that is where they should end up.
    $this->get(route('clients.index'))->assertRedirect(route('login'));

    $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'password',
    ])->assertRedirect(route('clients.index'));
});

test('users with two factor enabled are redirected to two factor challenge', function () {
    $this->skipUnlessFortifyHas(Features::twoFactorAuthentication());

    Features::twoFactorAuthentication([
        'confirm' => true,
        'confirmPassword' => true,
    ]);

    $user = User::factory()->withTwoFactor()->create();

    $response = $this->post(route('login'), [
        'email' => $user->email,
        'password' => 'password',
    ]);

    $response->assertRedirect(route('two-factor.login'));
    $response->assertSessionHas('login.id', $user->id);
    $this->assertGuest();
});

test('users can not authenticate with invalid password', function () {
    $user = User::factory()->create();

    $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'wrong-password',
    ]);

    $this->assertGuest();
});

test('users can logout', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post(route('logout'));

    $response->assertRedirect(route('home'));

    $this->assertGuest();
});

test('users are rate limited', function () {
    $user = User::factory()->create();

    RateLimiter::increment(md5('login'.implode('|', [$user->email, '127.0.0.1'])), amount: 5);

    $response = $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'wrong-password',
    ]);

    $response->assertTooManyRequests();
});

test('the front page serves both a visitor and someone signed in', function () {
    $this->get(route('home'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('welcome')
            ->where('auth.user', null)
        );

    $user = User::factory()->create(['name' => 'Margaret Chen']);

    $this->actingAs($user)
        ->get(route('home'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('welcome')
            // The welcome greets people by their first name.
            ->where('auth.user.name', 'Margaret Chen')
        );
});

test('the chosen palette is painted into the shell before react boots', function () {
    // withUnencryptedCookie, not withCookie: JavaScript writes this one, so it
    // arrives unencrypted and must stay excepted in bootstrap/app.php.
    // No cookie yet, so a first visitor gets the professional default.
    $this->get(route('home'))
        ->assertOk()
        ->assertSee('data-palette="graphite"', false);

    $this->withUnencryptedCookie('palette', 'mono')
        ->get(route('home'))
        ->assertSee('data-palette="mono"', false);

    // A crafted cookie cannot inject an attribute value.
    $this->withUnencryptedCookie('palette', '"><script>')
        ->get(route('home'))
        ->assertSee('data-palette="graphite"', false);
});
