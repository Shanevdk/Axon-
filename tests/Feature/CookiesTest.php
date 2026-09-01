<?php

use App\Models\User;
use Illuminate\Support\Facades\View;

/* ------------------------------------------------- preferences the browser sets */

test('a palette chosen in the browser is painted on by the server', function () {
    // Written from JavaScript, so it arrives unencrypted. If it is not
    // excepted from cookie encryption the server drops it, and the shell
    // paints the default over the top of the palette the person picked.
    $this->withUnencryptedCookie('palette', 'blueprint')
        ->get(route('home'))
        ->assertOk();

    expect(View::shared('palette'))->toBe('blueprint');
});

test('a palette nobody offers is refused', function (string $sent) {
    $this->withUnencryptedCookie('palette', $sent)->get(route('home'));

    expect(View::shared('palette'))->toBe('graphite');
})->with([
    'unknown name' => ['chartreuse'],
    'markup' => ['<script>alert(1)</script>'],
    'empty' => [''],
]);

test('an appearance chosen in the browser survives the trip too', function () {
    $this->withUnencryptedCookie('appearance', 'dark')->get(route('home'));

    expect(View::shared('appearance'))->toBe('dark');
});

/* ------------------------------------------------------ how the session is sent */

test('the session cookie is closed to javascript', function () {
    $user = User::factory()->create(['email' => 'margaret@vanhaven.ca']);

    $response = $this->actingAs($user)->get(route('dashboard'))->assertOk();

    $session = collect($response->headers->getCookies())
        ->first(fn ($cookie): bool => $cookie->getName() === config('session.cookie'));

    expect($session)->not->toBeNull()
        ->and($session->isHttpOnly())->toBeTrue();
});

test('cookies are marked secure when the deployment says so', function () {
    // Laravel Cloud serves over HTTPS only, so SESSION_SECURE_COOKIE=true
    // belongs in the production environment. Nothing enforces it but this.
    config()->set('session.secure', true);

    $user = User::factory()->create(['email' => 'margaret@vanhaven.ca']);

    $response = $this->actingAs($user)->get(route('dashboard'))->assertOk();

    $session = collect($response->headers->getCookies())
        ->first(fn ($cookie): bool => $cookie->getName() === config('session.cookie'));

    expect($session->isSecure())->toBeTrue();
});
