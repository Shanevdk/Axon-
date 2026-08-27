<?php

use App\Actions\Assistant\AskAboutTheBuilding;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

/**
 * A well-formed OpenRouter chat completion.
 */
function buildingCompletion(string $reply): array
{
    return [
        'id' => 'gen-test',
        'choices' => [
            ['message' => ['role' => 'assistant', 'content' => $reply]],
        ],
    ];
}

/**
 * The system message the editor's consultant was actually sent.
 */
function briefSentTo(Request $request): string
{
    return (string) data_get($request->data(), 'messages.0.content');
}

beforeEach(function () {
    config()->set('services.openrouter.key', 'test-key');
    config()->set('services.openrouter.model', 'test/model:free');
    config()->set('services.openrouter.url', 'https://openrouter.test/api/v1');
    config()->set('services.geocoder.url', 'https://geocoder.test/reverse');
});

test('guests cannot ask about a building', function () {
    $project = Project::factory()->create();

    $this->post(route('projects.assistant.reply', $project), [
        'messages' => [['role' => 'user', 'content' => 'Hello?']],
    ])->assertRedirect(route('login'));
});

test('a question about someone else’s building is refused', function () {
    Http::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('projects.assistant.reply', Project::factory()->create()), [
            'messages' => [['role' => 'user', 'content' => 'How wide are the doors?']],
        ])
        ->assertForbidden();

    Http::assertNothingSent();
});

test('a question comes back with the answer', function () {
    Http::fake([
        'openrouter.test/*' => Http::response(
            buildingCompletion('Your exit doors need a clear width of 850 mm.'),
        ),
    ]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.assistant.reply', $project), [
            'messages' => [['role' => 'user', 'content' => 'Are my exits wide enough?']],
            'survey' => 'Doors: 6 in all, 2 of them in exterior walls',
            'jurisdiction' => 'Kelowna, British Columbia, Canada',
        ])
        ->assertOk()
        ->assertJson(['reply' => 'Your exit doors need a clear width of 850 mm.']);
});

test('the drawing and the jurisdiction both reach the model', function () {
    Http::fake(['openrouter.test/*' => Http::response(buildingCompletion('Noted.'))]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)->postJson(route('projects.assistant.reply', $project), [
        'messages' => [['role' => 'user', 'content' => 'Check my stair.']],
        'survey' => 'Stairs: 1, 900 mm wide rising 3000 mm',
        'jurisdiction' => 'Kelowna, British Columbia, Canada',
    ])->assertOk();

    Http::assertSent(function (Request $request): bool {
        $brief = briefSentTo($request);

        // The wording wraps across lines in the brief, so only a phrase that
        // sits on one line is worth matching against.
        return str_contains($brief, 'Stairs: 1, 900 mm wide rising 3000 mm')
            && str_contains($brief, 'Kelowna, British Columbia, Canada')
            && str_contains($brief, 'having jurisdiction.');
    });
});

test('the project’s own jurisdiction is used when the browser sends none', function () {
    Http::fake(['openrouter.test/*' => Http::response(buildingCompletion('Noted.'))]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['jurisdiction' => 'Halifax, Nova Scotia, Canada']);

    $this->actingAs($user)->postJson(route('projects.assistant.reply', $project), [
        'messages' => [['role' => 'user', 'content' => 'What code applies?']],
    ])->assertOk();

    Http::assertSent(fn (Request $request): bool => str_contains(
        briefSentTo($request),
        'Halifax, Nova Scotia, Canada',
    ));
});

test('with nowhere named the model is told to ask where the building is', function () {
    Http::fake(['openrouter.test/*' => Http::response(buildingCompletion('Where is it?'))]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['jurisdiction' => null]);

    $this->actingAs($user)->postJson(route('projects.assistant.reply', $project), [
        'messages' => [['role' => 'user', 'content' => 'What fire rating do I need?']],
        'survey' => 'Storeys: 2',
    ])->assertOk();

    Http::assertSent(fn (Request $request): bool => str_contains(
        briefSentTo($request),
        'Nobody has said where this building is',
    ));
});

test('an empty drawing is described as empty rather than left unsaid', function () {
    Http::fake(['openrouter.test/*' => Http::response(buildingCompletion('Nothing drawn.'))]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)->postJson(route('projects.assistant.reply', $project), [
        'messages' => [['role' => 'user', 'content' => 'How many storeys?']],
        'survey' => '',
    ])->assertOk();

    Http::assertSent(fn (Request $request): bool => str_contains(
        briefSentTo($request),
        'Nothing has been drawn yet',
    ));
});

test('an enormous survey is refused rather than forwarded', function () {
    Http::fake();

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.assistant.reply', $project), [
            'messages' => [['role' => 'user', 'content' => 'Anything?']],
            'survey' => Str::repeat('a', AskAboutTheBuilding::SURVEY_LIMIT + 1),
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('survey');

    Http::assertNothingSent();
});

test('a survey at the limit still reaches the model whole', function () {
    Http::fake(['openrouter.test/*' => Http::response(buildingCompletion('Noted.'))]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();
    $survey = Str::repeat('a', AskAboutTheBuilding::SURVEY_LIMIT);

    $this->actingAs($user)
        ->postJson(route('projects.assistant.reply', $project), [
            'messages' => [['role' => 'user', 'content' => 'Anything?']],
            'survey' => $survey,
        ])
        ->assertOk();

    Http::assertSent(fn (Request $request): bool => str_contains(
        briefSentTo($request),
        $survey,
    ));
});

test('an upstream failure is reported in words rather than as a crash', function () {
    Http::fake([
        'openrouter.test/*' => Http::response(['error' => ['message' => 'Model retired.']], 404),
    ]);

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.assistant.reply', $project), [
            'messages' => [['role' => 'user', 'content' => 'Hello?']],
        ])
        ->assertStatus(503)
        ->assertJson(['message' => 'Model retired.']);
});

test('the editor is told whether the consultant can be reached', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn (AssertableInertia $page) => $page->where('assistantReady', true));

    config()->set('services.openrouter.key', null);

    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn (AssertableInertia $page) => $page->where('assistantReady', false));
});

/* --------------------------------------------------------- the jurisdiction */

test('answering where the building is saves it on the project', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['jurisdiction' => null]);

    $this->actingAs($user)
        ->put(route('projects.jurisdiction.update', $project), [
            'jurisdiction' => 'Kelowna, British Columbia, Canada',
        ])
        ->assertRedirect();

    expect($project->fresh()->jurisdiction)->toBe('Kelowna, British Columbia, Canada');
});

test('clearing the location empties it rather than storing a blank', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create(['jurisdiction' => 'Somewhere']);

    $this->actingAs($user)
        ->put(route('projects.jurisdiction.update', $project), ['jurisdiction' => ''])
        ->assertRedirect();

    expect($project->fresh()->jurisdiction)->toBeNull();
});

test('only the team can set where a building is', function () {
    $project = Project::factory()->create(['jurisdiction' => 'Untouched']);

    $this->actingAs(User::factory()->create())
        ->put(route('projects.jurisdiction.update', $project), ['jurisdiction' => 'Elsewhere'])
        ->assertForbidden();

    expect($project->fresh()->jurisdiction)->toBe('Untouched');
});

/* ------------------------------------------------------------- the locator */

test('coordinates come back as a place name', function () {
    Http::fake([
        'geocoder.test/*' => Http::response([
            'city' => 'Kelowna',
            'principalSubdivision' => 'British Columbia',
            'countryName' => 'Canada',
        ]),
    ]);

    $this->actingAs(User::factory()->create())
        ->postJson(route('assistant.place'), [
            'latitude' => 49.888,
            'longitude' => -119.496,
        ])
        ->assertOk()
        ->assertJson(['place' => 'Kelowna, British Columbia, Canada']);
});

test('coordinates are rounded before they leave', function () {
    Http::fake([
        'geocoder.test/*' => Http::response(['city' => 'Kelowna', 'countryName' => 'Canada']),
    ]);

    $this->actingAs(User::factory()->create())
        ->postJson(route('assistant.place'), [
            'latitude' => 49.8880123456,
            'longitude' => -119.4961987654,
        ])
        ->assertOk();

    Http::assertSent(fn (Request $request): bool => $request['latitude'] === 49.888
        && $request['longitude'] === -119.496);
});

test('a second lookup nearby is served from the cache', function () {
    Cache::flush();

    Http::fake([
        'geocoder.test/*' => Http::response(['city' => 'Kelowna', 'countryName' => 'Canada']),
    ]);

    $user = User::factory()->create();
    $coordinates = ['latitude' => 49.888, 'longitude' => -119.496];

    $this->actingAs($user)->postJson(route('assistant.place'), $coordinates)->assertOk();
    $this->actingAs($user)->postJson(route('assistant.place'), $coordinates)->assertOk();

    Http::assertSentCount(1);
});

test('a geocoder that names nowhere is reported in words', function () {
    Cache::flush();

    Http::fake(['geocoder.test/*' => Http::response([], 500)]);

    $this->actingAs(User::factory()->create())
        ->postJson(route('assistant.place'), ['latitude' => 0, 'longitude' => 0])
        ->assertStatus(503)
        ->assertJson([
            'message' => 'Could not work out where that is. Type the city and country instead.',
        ]);
});

test('nonsense coordinates are refused before anything is called', function () {
    Http::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('assistant.place'), ['latitude' => 999, 'longitude' => 0])
        ->assertStatus(422);

    Http::assertNothingSent();
});
