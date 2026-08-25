<?php

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

/**
 * The smallest thing that counts as a JPEG body.
 */
function imageBody(): string
{
    return "\xFF\xD8\xFF\xE0".str_repeat('x', 64);
}

/**
 * A render request the validator is happy with.
 *
 * @return array<string, mixed>
 */
function renderPayload(array $overrides = []): array
{
    return [
        'prompt' => 'Architectural photograph of a two-storey brick house with a pitched roof.',
        'width' => 1216,
        'height' => 684,
        'seed' => 4242,
        ...$overrides,
    ];
}

beforeEach(function () {
    config()->set('services.pollinations.url', 'https://images.test');
    config()->set('services.pollinations.model', 'test-model');
});

test('guests cannot render', function () {
    $project = Project::factory()->create();

    $this->post(route('projects.render', $project), renderPayload())
        ->assertRedirect(route('login'));
});

test('a render is refused for someone else project', function () {
    $project = Project::factory()->create();
    Http::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertForbidden();

    Http::assertNothingSent();
});

test('a render comes back as a data url', function () {
    Http::fake([
        'images.test/*' => Http::response(imageBody(), 200, ['Content-Type' => 'image/jpeg']),
    ]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $response = $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertOk();

    expect($response->json('image'))
        ->toStartWith('data:image/jpeg;base64,')
        ->and(base64_decode(substr($response->json('image'), strlen('data:image/jpeg;base64,'))))
        ->toBe(imageBody());
});

test('the prompt travels in the path and the frame in the query', function () {
    Http::fake([
        'images.test/*' => Http::response(imageBody(), 200, ['Content-Type' => 'image/jpeg']),
    ]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertOk();

    Http::assertSent(function (Request $request) {
        $url = $request->url();

        expect($url)->toContain('https://images.test/prompt/')
            ->and(rawurldecode($url))->toContain('two-storey brick house')
            ->and($url)->toContain('width=1216')
            ->and($url)->toContain('height=684')
            ->and($url)->toContain('seed=4242')
            ->and($url)->toContain('model=test-model')
            // The generator otherwise stamps its mark into the corner.
            ->and($url)->toContain('nologo=true');

        return true;
    });
});

test('the frame and the prompt are both bounded', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    Http::fake();

    $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload(['prompt' => 'tiny']))
        ->assertJsonValidationErrors('prompt');

    $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload(['width' => 4096]))
        ->assertJsonValidationErrors('width');

    Http::assertNothingSent();
});

test('a busy generator is explained rather than thrown', function () {
    Http::fake(['images.test/*' => Http::response('slow down', 429)]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertStatus(503)
        ->assertJsonPath('message', 'The free image generator is busy right now. Wait a moment and render again.');
});

test('a non image answer is refused', function () {
    Http::fake([
        'images.test/*' => Http::response('{"error":"nope"}', 200, ['Content-Type' => 'application/json']),
    ]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertStatus(503)
        ->assertJsonPath('message', 'The generator sent something that was not an image. Try again.');
});

test('a teammate can render the studio work', function () {
    Http::fake([
        'images.test/*' => Http::response(imageBody(), 200, ['Content-Type' => 'image/jpeg']),
    ]);

    $organization = Organization::factory()->create();
    $owner = User::factory()->create(['organization_id' => $organization->id]);
    $mate = User::factory()->create(['organization_id' => $organization->id]);
    $project = Project::factory()->for($owner)->create();

    $this->actingAs($mate)
        ->postJson(route('projects.render', $project), renderPayload())
        ->assertOk();
});
