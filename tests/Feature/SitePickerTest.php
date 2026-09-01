<?php

use App\Actions\Site\FindPlaces;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Http;

/**
 * One result in the shape the geocoder answers with.
 *
 * @return array<string, mixed>
 */
function nominatimResult(array $overrides = []): array
{
    return [
        'display_name' => '1490 West 7th Avenue, Fairview, Vancouver, British Columbia, Canada',
        'lat' => '49.26421700',
        'lon' => '-123.13805400',
        'address' => [
            'city' => 'Vancouver',
            'state' => 'British Columbia',
            'country' => 'Canada',
        ],
        ...$overrides,
    ];
}

test('an address search comes back as places to put the pin on', function () {
    Http::fake([
        '*' => Http::response([nominatimResult()]),
    ]);

    $this->actingAs(User::factory()->create())
        ->getJson(route('site.places', ['q' => '1490 West 7th Vancouver']))
        ->assertOk()
        ->assertJsonPath('places.0.label', '1490 West 7th Avenue, Fairview, Vancouver, British Columbia, Canada')
        ->assertJsonPath('places.0.latitude', 49.264217)
        ->assertJsonPath('places.0.longitude', -123.138054)
        // Siting the building also settles which code its walls answer to.
        ->assertJsonPath('places.0.region', 'Vancouver, British Columbia, Canada');
});

test('the geocoder is told who is calling, as its terms require', function () {
    Http::fake(['*' => Http::response([])]);

    app(FindPlaces::class)->handle('somewhere');

    Http::assertSent(
        fn ($request): bool => str_contains(
            $request->header('User-Agent')[0] ?? '',
            (string) config('app.name'),
        ),
    );
});

test('a second search for the same address does not ask again', function () {
    Http::fake(['*' => Http::response([nominatimResult()])]);

    $places = app(FindPlaces::class);

    $places->handle('1490 West 7th Vancouver');
    $places->handle('  1490   West 7th Vancouver  ');

    // Squished and lower cased into one cache key: an address does not move.
    Http::assertSentCount(1);
});

test('a keystroke is not an address', function () {
    Http::fake();

    expect(app(FindPlaces::class)->handle('14'))->toBe([]);

    Http::assertNothingSent();
});

test('a geocoder that is down leaves the pin to be dropped by hand', function () {
    Http::fake(['*' => Http::response(status: 503)]);

    expect(app(FindPlaces::class)->handle('1490 West 7th Vancouver'))->toBe([]);
});

test('a failed lookup is not cached for a month', function () {
    // Down once, up on the retry. A service having a bad minute must not
    // leave the studio unable to search that address until next month.
    Http::fakeSequence()
        ->pushStatus(503)
        ->push([nominatimResult()]);

    $places = app(FindPlaces::class);

    expect($places->handle('1490 West 7th'))->toBe([])
        ->and($places->handle('1490 West 7th'))->toHaveCount(1);
});

test('a result without coordinates is dropped rather than sent on', function () {
    Http::fake([
        '*' => Http::response([
            nominatimResult(['lat' => null, 'lon' => null]),
            nominatimResult(),
        ]),
    ]);

    expect(app(FindPlaces::class)->handle('anywhere'))->toHaveCount(1);
});

test('a place with no city still names what it can', function () {
    Http::fake([
        '*' => Http::response([
            nominatimResult(['address' => ['country' => 'Canada']]),
        ]),
    ]);

    expect(app(FindPlaces::class)->handle('somewhere')[0]['region'])->toBe('Canada');
});

test('guests cannot search addresses on the studio account', function () {
    $this->getJson(route('site.places', ['q' => 'Vancouver']))->assertUnauthorized();
});

test('a project keeps the spot picked for it on the map', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('projects.store'), [
            'name' => 'Chen Residence',
            'units' => 'metric',
            'template' => 'blank',
            'address' => '1490 West 7th Avenue, Vancouver',
            'jurisdiction' => 'Vancouver, British Columbia, Canada',
            'latitude' => 49.264217,
            'longitude' => -123.138054,
        ]);

    $project = Project::query()->sole();

    expect($project->latitude)->toBe(49.264217)
        ->and($project->longitude)->toBe(-123.138054)
        ->and($project->jurisdiction)->toBe('Vancouver, British Columbia, Canada');
});

test('half a coordinate is not a place', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('projects.store'), [
            'name' => 'Chen Residence',
            'units' => 'metric',
            'template' => 'blank',
            'latitude' => 49.264217,
        ])
        ->assertSessionHasErrors('longitude');
});

test('a coordinate off the earth is refused', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('projects.store'), [
            'name' => 'Chen Residence',
            'units' => 'metric',
            'template' => 'blank',
            'latitude' => 91,
            'longitude' => 0,
        ])
        ->assertSessionHasErrors('latitude');
});

test('the pin can be moved from project information', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create([
        'latitude' => 49.264217,
        'longitude' => -123.138054,
    ]);

    $this->actingAs($user)
        ->put(route('projects.update', $project), [
            'name' => $project->name,
            'units' => 'metric',
            'latitude' => 50.1,
            'longitude' => -119.5,
        ]);

    expect($project->refresh()->latitude)->toBe(50.1);
});

test('the editor is told where the building stands', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create([
        'latitude' => 49.264217,
        'longitude' => -123.138054,
    ]);

    // The ground levels dialog opens on the pin rather than on the equator.
    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn ($page) => $page
            ->where('project.latitude', 49.264217)
            ->where('project.longitude', -123.138054)
        );
});

test('the map tiles and their attribution reach the browser', function () {
    // The licence on borrowed tiles has to be shown beside them, so the
    // attribution travels with the URL rather than being hard coded.
    $this->actingAs(User::factory()->create())
        ->get(route('projects.index'))
        ->assertInertia(fn ($page) => $page
            ->where('map.tiles', config('services.places.tiles'))
            ->where('map.attribution', config('services.places.attribution'))
        );
});
