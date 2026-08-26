<?php

use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

test('guests are redirected away from the project list', function () {
    $this->get(route('projects.index'))->assertRedirect(route('login'));
});

test('the project list only shows the projects a user owns', function () {
    $user = User::factory()->create();
    $mine = Project::factory()->for($user)->create(['name' => 'Kitsilano Laneway']);
    Project::factory()->create(['name' => 'Someone Else']);

    $this->actingAs($user)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('projects/index')
            ->has('projects', 1)
            ->where('projects.0.id', $mine->id)
            ->where('projects.0.name', 'Kitsilano Laneway')
        );
});

test('the project list summarises the model document', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('projects.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('projects.0.summary.levels', 3)
            ->where('projects.0.summary.walls', 9)
            ->where('projects.0.summary.rooms', 5)
            ->where('projects.0.summary.openings', 14)
        );
});

test('a blank project is created with levels and wall types but no elements', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->post(route('projects.store'), [
        'name' => 'Point Grey House',
        'number' => '2610',
        'client' => 'A. Client',
        'address' => '1 West 4th Ave',
        'units' => 'metric',
        'template' => 'blank',
    ]);

    $project = Project::query()->sole();

    $response->assertRedirect(route('projects.show', $project));

    expect($project->name)->toBe('Point Grey House')
        ->and($project->user_id)->toBe($user->id)
        ->and($project->document['elements'])->toBe([])
        ->and($project->document['levels'])->toHaveCount(3)
        ->and($project->document['wallTypes'])->not->toBeEmpty();
});

test('the residence template seeds a drawable plan', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->post(route('projects.store'), [
        'name' => 'Sample',
        'units' => 'metric',
        'template' => 'residence',
    ]);

    $elements = collect(Project::query()->sole()->document['elements']);

    expect($elements->where('kind', 'wall'))->toHaveCount(9)
        ->and($elements->where('kind', 'room'))->toHaveCount(5)
        ->and($elements->where('kind', 'door'))->toHaveCount(6)
        ->and($elements->where('kind', 'window'))->toHaveCount(8);

    // Every opening must reference a wall that exists, or it cannot be drawn.
    $wallIds = $elements->where('kind', 'wall')->pluck('id');

    $elements->whereIn('kind', ['door', 'window'])->each(
        fn (array $opening) => expect($wallIds)->toContain($opening['host'])
    );
});

test('creating a project requires a name, units and a template', function () {
    $this->actingAs(User::factory()->create())
        ->post(route('projects.store'), [])
        ->assertSessionHasErrors(['name', 'units', 'template']);
});

test('the editor renders the project document', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('projects/editor')
            ->where('project.id', $project->id)
            ->has('document.levels', 3)
            ->has('document.elements')
        );
});

test('opening a project records when it was last opened', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->neverOpened()->create();

    $this->actingAs($user)->get(route('projects.show', $project))->assertOk();

    expect($project->fresh()->opened_at)->not->toBeNull();
});

test('a user cannot open a project belonging to someone else', function () {
    $project = Project::factory()->create();

    $this->actingAs(User::factory()->create())
        ->get(route('projects.show', $project))
        ->assertForbidden();
});

test('project information can be updated by its owner', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->put(route('projects.update', $project), [
            'name' => 'Renamed Residence',
            'number' => '2699',
            'client' => 'New Client',
            'address' => '99 Test Road',
            'units' => 'imperial',
        ])
        ->assertRedirect();

    expect($project->fresh())
        ->name->toBe('Renamed Residence')
        ->number->toBe('2699')
        ->units->toBe('imperial');
});

test('project information cannot be updated by anyone else', function () {
    $project = Project::factory()->create(['name' => 'Untouched']);

    $this->actingAs(User::factory()->create())
        ->put(route('projects.update', $project), [
            'name' => 'Hijacked',
            'units' => 'metric',
        ])
        ->assertForbidden();

    expect($project->fresh()->name)->toBe('Untouched');
});

test('the model document is persisted as json', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $document = $project->document;
    $document['elements'] = [[
        'id' => 'wall-1',
        'kind' => 'wall',
        'level' => 'level-1',
        'typeId' => 'generic-200',
        'a' => ['x' => 0, 'y' => 0],
        'b' => ['x' => 5000, 'y' => 0],
        'height' => 3000,
        'baseOffset' => 0,
        'locationLine' => 'center',
    ]];

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk()
        ->assertJsonStructure(['saved_at']);

    $saved = $project->fresh()->document;

    expect($saved['elements'])->toHaveCount(1)
        ->and($saved['elements'][0]['b']['x'])->toBe(5000);
});

test('a document without levels is rejected', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => ['version' => 1, 'elements' => []],
        ])
        ->assertJsonValidationErrors('document.levels');
});

test('a document cannot be saved into someone elses project', function () {
    $project = Project::factory()->create();

    $this->actingAs(User::factory()->create())
        ->putJson(route('projects.document.update', $project), [
            'document' => ['version' => 1, 'levels' => [], 'elements' => []],
        ])
        ->assertForbidden();
});

test('a project can be deleted by its owner', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->delete(route('projects.destroy', $project))
        ->assertRedirect(route('projects.index'));

    expect(Project::query()->count())->toBe(0);
});

test('a project cannot be deleted by anyone else', function () {
    $project = Project::factory()->create();

    $this->actingAs(User::factory()->create())
        ->delete(route('projects.destroy', $project))
        ->assertForbidden();

    expect(Project::query()->count())->toBe(1);
});

test('deleting a user removes their projects', function () {
    $user = User::factory()->create();
    Project::factory()->for($user)->count(2)->create();

    $user->delete();

    expect(Project::query()->count())->toBe(0);
});

test('a document with an imported mesh element persists and previews', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $document = $project->document;
    $document['elements'] = [[
        'id' => 'mesh-1',
        'kind' => 'mesh',
        'level' => 'level-1',
        'name' => 'Eames Chair',
        'p' => ['x' => 2000, 'y' => 1500],
        'rotation' => 0,
        'scale' => 1,
        'baseOffset' => 0,
        'vertices' => [0, 0, 0, 100, 0, 0, 100, 100, 0],
        'footprint' => [['x' => 0, 'y' => 0], ['x' => 100, 'y' => 0], ['x' => 100, 'y' => 100]],
        'size' => ['x' => 100, 'y' => 100, 'z' => 0],
    ]];

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), ['document' => $document])
        ->assertOk();

    $preview = $project->fresh()->planPreview();

    expect($preview)->not->toBeNull()
        ->and($preview['elements'])->toHaveCount(1)
        ->and($preview['elements'][0]['kind'])->toBe('mesh')
        // The triangles are stripped from previews to keep the payload small.
        ->and($preview['elements'][0]['vertices'])->toBe([])
        ->and($preview['elements'][0]['footprint'])->toHaveCount(3);
});

test('opening a project with a partial document backfills the type catalogues', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    // A fragment like this reached the database before saves required the
    // catalogues; the editor crashed reading wallTypes[0] of undefined.
    $project->forceFill(['document' => [
        'version' => 1,
        'levels' => [['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0]],
        'elements' => [],
    ]])->save();

    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('projects/editor')
            ->where('document.units', 'metric')
            ->has('document.wallTypes', 6)
            ->has('document.doorTypes')
            ->has('document.windowTypes')
            ->where('document.levels.0.id', 'level-1')
        );
});

test('a document without wall types is rejected', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => [
                'version' => 1,
                'units' => 'metric',
                'levels' => [['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0]],
                'elements' => [],
            ],
        ])
        ->assertJsonValidationErrors('document.wallTypes');
});

test('signing in toward a drawing that has gone lands on the register', function () {
    $user = User::factory()->create(['signed_in_at' => now()->subDay()]);

    // Bounced off a drawing that no longer exists — a deleted project, or a
    // database rebuilt underneath them.
    $this->get('/projects/999999')->assertRedirect(route('login'));

    $this->post(route('login.store'), [
        'email' => $user->email,
        'password' => 'password',
    ])->assertRedirect('/projects/999999');

    $this->actingAs($user)
        ->get('/projects/999999')
        ->assertRedirect(route('projects.index'));
});

test('a guest still gets a plain 404 for a missing drawing', function () {
    // Only signed-in people get the friendly landing; nothing is leaked to
    // anyone else about which ids exist.
    $this->get('/projects/999999')->assertRedirect(route('login'));

    $this->getJson('/projects/999999')->assertUnauthorized();
});
