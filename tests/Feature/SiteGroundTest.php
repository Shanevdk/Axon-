<?php

use App\Actions\Site\FetchGroundLevels;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    Cache::flush();
    config()->set('services.ground.url', 'https://ground.test/elevation');
    config()->set('services.ground.label', 'Test terrain model');
});

/**
 * Ground that rises evenly to the east, whatever is asked for: one metre of
 * rise for every ten-thousandth of a degree of longitude.
 */
function slopingGround(): void
{
    Http::fake([
        'ground.test/*' => function ($request) {
            $longitudes = explode(',', $request->data()['longitude']);

            return Http::response([
                'elevation' => array_map(
                    fn (string $longitude): float => 100 + (float) $longitude * 10_000,
                    $longitudes,
                ),
            ]);
        },
    ]);
}

function aProject(): Project
{
    $user = User::factory()->create(['email' => 'margaret@vanhaven.ca']);

    return Project::factory()->for($user)->create();
}

/* -------------------------------------------------------------- the action */

test('it lays a square of samples over the property', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 12.0)])]);

    $site = app(FetchGroundLevels::class)->handle(49.2, -122.9, 40);

    expect($site['terrain']['columns'])->toBe(9)
        ->and($site['terrain']['rows'])->toBe(9)
        ->and($site['terrain']['heights'])->toHaveCount(81)
        // 40 metres across, in millimetres, centred on the model origin.
        ->and($site['terrain']['spacing'])->toBe(5000.0)
        ->and($site['terrain']['originX'])->toBe(-20_000.0)
        ->and($site['terrain']['originY'])->toBe(-20_000.0);
});

test('it levels the ground floor onto the middle of the property', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 87.5)])]);

    $site = app(FetchGroundLevels::class)->handle(49.2, -122.9, 40);

    // Model zero is ground level at the centre, so nothing in the document
    // carries a number in the hundreds of metres.
    expect($site['seaLevel'])->toBe(87.5)
        ->and($site['terrain']['heights'])->each->toBe(0);
});

test('it keeps the shape of the land, in millimetres', function () {
    slopingGround();

    $site = app(FetchGroundLevels::class)->handle(0.0, 0.0, 100);
    $heights = $site['terrain']['heights'];
    $columns = $site['terrain']['columns'];

    // Rising to the east means every step along a row is a step up, and the
    // rows themselves are identical.
    expect($heights[0])->toBeLessThan($heights[$columns - 1])
        ->and(array_slice($heights, 0, $columns))
        ->toBe(array_slice($heights, $columns, $columns));
});

test('it reads the samples west to east, then south to north', function () {
    // The order is a contract with `Terrain` in the model, which reads its
    // heights row-major from the south-west corner. If these two disagree the
    // ground comes out mirrored and nothing says so.
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 25, 5.0)])]);

    app(FetchGroundLevels::class)->handle(0.0, 0.0, 40, 4);

    Http::assertSent(function ($request) {
        $latitudes = explode(',', $request->data()['latitude']);
        $longitudes = explode(',', $request->data()['longitude']);

        return (float) $longitudes[0] < (float) $longitudes[1]
            && (float) $latitudes[0] === (float) $latitudes[4]
            && (float) $latitudes[0] < (float) $latitudes[5];
    });
});

test('it says where the ground came from', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 3.0)])]);

    expect(app(FetchGroundLevels::class)->handle(49.2, -122.9, 40)['source'])
        ->toBe('Test terrain model');
});

test('it asks a shared service only once for the same ground', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 3.0)])]);

    app(FetchGroundLevels::class)->handle(49.2, -122.9, 40);
    app(FetchGroundLevels::class)->handle(49.2, -122.9, 40);

    Http::assertSentCount(1);
});

test('it splits a large survey across requests the service will accept', function () {
    // 12 steps is 169 points, which is more than one request may carry.
    Http::fake(['ground.test/*' => function ($request) {
        $count = count(explode(',', $request->data()['latitude']));

        return Http::response(['elevation' => array_fill(0, $count, 4.0)]);
    }]);

    $site = app(FetchGroundLevels::class)->handle(49.2, -122.9, 240, 12);

    expect($site['terrain']['heights'])->toHaveCount(169);
    Http::assertSentCount(2);
});

test('it refuses a half-measured property rather than inventing the rest', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => [1.0, 2.0]])]);

    expect(fn () => app(FetchGroundLevels::class)->handle(49.2, -122.9, 40))
        ->toThrow(RuntimeException::class);
});

test('a failed lookup is not remembered', function () {
    Http::fake(['ground.test/*' => Http::response([], 500)]);

    expect(fn () => app(FetchGroundLevels::class)->handle(49.2, -122.9, 40))
        ->toThrow(RuntimeException::class);

    expect(Cache::has('ground:49.2,-122.9,40,8'))->toBeFalse();
});

test('it holds an even number of steps so the centre is a real sample', function () {
    Http::fake(['ground.test/*' => function ($request) {
        return Http::response([
            'elevation' => array_fill(0, count(explode(',', $request->data()['latitude'])), 9.0),
        ]);
    }]);

    // Seven would put the datum between four samples instead of on one.
    $site = app(FetchGroundLevels::class)->handle(49.2, -122.9, 40, 7);

    expect($site['terrain']['columns'])->toBe(7);
});

/* ------------------------------------------------------------ the endpoint */

test('the editor can measure the ground under a project', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 20.0)])]);

    $project = aProject();

    $this->actingAs($project->user)
        ->postJson(route('projects.site.ground', $project), [
            'latitude' => 49.2827,
            'longitude' => -123.1207,
            'span' => 40,
        ])
        ->assertOk()
        ->assertJsonPath('site.terrain.columns', 9)
        ->assertJsonPath('site.seaLevel', 20);
});

test('somebody else\'s project is not theirs to survey', function () {
    Http::fake(['ground.test/*' => Http::response(['elevation' => array_fill(0, 81, 20.0)])]);

    $stranger = User::factory()->create(['email' => 'stranger@vanhaven.ca']);

    $this->actingAs($stranger)
        ->postJson(route('projects.site.ground', aProject()), [
            'latitude' => 49.2827,
            'longitude' => -123.1207,
            'span' => 40,
        ])
        ->assertForbidden();

    Http::assertNothingSent();
});

test('a property has to be somewhere on earth', function (array $body) {
    $project = aProject();

    $this->actingAs($project->user)
        ->postJson(route('projects.site.ground', $project), $body)
        ->assertStatus(422);
})->with([
    'off the map' => [['latitude' => 200, 'longitude' => 0, 'span' => 40]],
    'no longitude' => [['latitude' => 49.2, 'span' => 40]],
    'finer than the data' => [['latitude' => 49.2, 'longitude' => -122.9, 'span' => 5]],
    'a whole county' => [['latitude' => 49.2, 'longitude' => -122.9, 'span' => 50_000]],
]);

test('a service that is down is reported, not swallowed', function () {
    Http::fake(['ground.test/*' => Http::response([], 503)]);

    $project = aProject();

    $this->actingAs($project->user)
        ->postJson(route('projects.site.ground', $project), [
            'latitude' => 49.2827,
            'longitude' => -123.1207,
            'span' => 40,
        ])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            fn (string $message): bool => str_contains($message, 'ground levels'),
        );
});
