<?php

use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

/**
 * A one-level preview of the kind the editor sends up.
 *
 * @return array<string, mixed>
 */
function previewDocument(): array
{
    return [
        'version' => 1,
        'units' => 'metric',
        'levels' => [['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0]],
        'wallTypes' => [[
            'id' => 'generic-200',
            'name' => 'Generic - 200mm',
            'thickness' => 200,
            'function' => 'exterior',
        ]],
        'doorTypes' => [],
        'windowTypes' => [],
        'elements' => [[
            'id' => 'w1',
            'kind' => 'wall',
            'level' => 'level-1',
            'typeId' => 'generic-200',
            'a' => ['x' => 0, 'y' => 0],
            'b' => ['x' => 6000, 'y' => 0],
            'height' => 3000,
            'baseOffset' => 0,
            'locationLine' => 'center',
        ]],
        'viewSettings' => [],
    ];
}

/**
 * Counts for the whole model, of which the preview shows one level.
 *
 * @return array<string, mixed>
 */
function wholeModelSummary(): array
{
    return [
        'levels' => 3,
        'walls' => 40,
        'rooms' => 9,
        'openings' => 14,
        'wallLength' => 180_000,
        'slabArea' => 250_000_000,
    ];
}

test('sending a summary moves the model off the server', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    // Eloquent has not read the column default back yet.
    expect($project->refresh()->has_local_model)->toBeFalse();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => wholeModelSummary(),
        ])
        ->assertOk();

    $project->refresh();

    expect($project->has_local_model)->toBeTrue()
        ->and($project->document['elements'])->toHaveCount(1)
        ->and($project->summary['walls'])->toBe(40);
});

test('the client model is stored alongside the preview', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $house = [
        ...previewDocument(),
        'levels' => [
            ['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0],
            ['id' => 'level-2', 'name' => 'Level 2', 'elevation' => 3000],
        ],
    ];

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => wholeModelSummary(),
            'client_model' => $house,
        ])
        ->assertOk();

    $project->refresh();

    // The preview keeps its one level for the thumbnail; the portal gets both.
    expect($project->document['levels'])->toHaveCount(1)
        ->and($project->client_model['levels'])->toHaveCount(2);
});

test('a save that carries no client model leaves the stored one alone', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create([
        'client_model' => previewDocument(),
    ]);

    // Not sending one means "nothing new to say", not "the house is gone" —
    // otherwise an older editor tab would empty the client's portal.
    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => wholeModelSummary(),
        ])
        ->assertOk();

    expect($project->refresh()->client_model)->not->toBeNull();
});

test('an emptied drawing clears the client model', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create([
        'client_model' => previewDocument(),
    ]);

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => wholeModelSummary(),
            'client_model' => null,
        ])
        ->assertOk();

    expect($project->refresh()->client_model)->toBeNull();
});

test('a document sent without a summary is still stored whole', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
        ])
        ->assertOk();

    $project->refresh();

    expect($project->has_local_model)->toBeFalse()
        ->and($project->summary)->toBeNull();
});

test('the editor is sent the whole model only while the server still has it', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    // Never saved locally: the server copy is the model, so hand it over.
    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('hasLocalModel', false)
            ->has('document.elements')
        );

    $project->forceFill(['has_local_model' => true])->save();

    // Now it is only a preview, so sending it would be a lie.
    $this->actingAs($user)
        ->get(route('projects.show', $project))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('hasLocalModel', true)
            ->where('document', null)
        );
});

test('the register counts the whole model, not the previewed level', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => wholeModelSummary(),
        ])
        ->assertOk();

    $this->actingAs($user)
        ->get(route('projects.index'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            // The preview holds one wall; the model holds forty.
            ->where('projects.0.summary.walls', 40)
            ->where('projects.0.summary.levels', 3)
            ->has('projects.0.preview.elements', 1)
        );
});

test('the summary must be complete when it is offered at all', function () {
    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->putJson(route('projects.document.update', $project), [
            'document' => previewDocument(),
            'summary' => ['levels' => 2],
        ])
        ->assertJsonValidationErrors(['summary.walls', 'summary.wallLength']);

    expect($project->refresh()->has_local_model)->toBeFalse();
});
