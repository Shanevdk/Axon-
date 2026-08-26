<?php

use App\Mcp\Servers\CadServer;
use App\Mcp\Tools\AddLevelTool;
use App\Mcp\Tools\CreateWallsTool;
use App\Mcp\Tools\DeleteElementsTool;
use App\Mcp\Tools\GetDocumentTool;
use App\Mcp\Tools\ListProjectsTool;
use App\Mcp\Tools\PlaceOpeningTool;
use App\Mcp\Tools\PlaceRoomTool;
use App\Models\Project;

test('projects are listed with their summaries', function () {
    Project::factory()->withSampleResidence()->create(['name' => 'Kitsilano Laneway']);

    $response = CadServer::tool(ListProjectsTool::class);

    $response->assertOk()->assertSee('Kitsilano Laneway');
});

test('the document is returned with its catalogues backfilled', function () {
    $project = Project::factory()->create();

    // Partial documents reach the database; tools heal them like the editor.
    $project->forceFill(['document' => [
        'version' => 1,
        'levels' => [['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0]],
        'elements' => [],
    ]])->save();

    $response = CadServer::tool(GetDocumentTool::class, [
        'project_id' => $project->id,
    ]);

    $response->assertOk()->assertSee('wallTypes');
});

test('walls are created on a level in millimetres', function () {
    $project = Project::factory()->create();

    $response = CadServer::tool(CreateWallsTool::class, [
        'project_id' => $project->id,
        'level' => 'level-1',
        'walls' => [
            ['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]],
            ['a' => ['x' => 6000, 'y' => 0], 'b' => ['x' => 6000, 'y' => 4000]],
        ],
    ]);

    $response->assertOk()->assertSee('2 wall(s) added');

    $walls = collect($project->fresh()->document['elements'])
        ->where('kind', 'wall');

    expect($walls)->toHaveCount(2)
        ->and($walls->first()['b']['x'])->toEqual(6000)
        ->and($walls->first()['height'])->toEqual(3000)
        ->and($walls->first()['locationLine'])->toBe('center');
});

test('creating walls on an unknown level names the real levels', function () {
    $project = Project::factory()->create();

    $response = CadServer::tool(CreateWallsTool::class, [
        'project_id' => $project->id,
        'level' => 'basement',
        'walls' => [
            ['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]],
        ],
    ]);

    $response->assertHasErrors()->assertSee('level-1');
});

test('a door is placed in a wall and clamped inside it', function () {
    $project = Project::factory()->create();

    $created = CadServer::tool(CreateWallsTool::class, [
        'project_id' => $project->id,
        'level' => 'level-1',
        'walls' => [['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]]],
    ]);
    $created->assertOk();

    $wallId = collect($project->fresh()->document['elements'])
        ->firstWhere('kind', 'wall')['id'];

    // 50 mm from the start would hang past the wall end; it must clamp.
    $response = CadServer::tool(PlaceOpeningTool::class, [
        'project_id' => $project->id,
        'kind' => 'door',
        'host' => $wallId,
        'at' => 50,
    ]);

    $response->assertOk();

    $door = collect($project->fresh()->document['elements'])
        ->firstWhere('kind', 'door');
    $width = collect($project->fresh()->document['doorTypes'])
        ->firstWhere('id', $door['typeId'])['width'];

    expect($door['host'])->toBe($wallId)
        ->and($door['t'])->toBeGreaterThanOrEqual($width / 2 / 6000);
});

test('an opening wider than its host is refused', function () {
    $project = Project::factory()->create();

    CadServer::tool(CreateWallsTool::class, [
        'project_id' => $project->id,
        'level' => 'level-1',
        'walls' => [['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 800, 'y' => 0]]],
    ])->assertOk();

    $wallId = collect($project->fresh()->document['elements'])
        ->firstWhere('kind', 'wall')['id'];

    CadServer::tool(PlaceOpeningTool::class, [
        'project_id' => $project->id,
        'kind' => 'door',
        'host' => $wallId,
        'at' => 400,
    ])->assertHasErrors();
});

test('a room is tagged with the next number for its level', function () {
    $project = Project::factory()->create();

    $response = CadServer::tool(PlaceRoomTool::class, [
        'project_id' => $project->id,
        'level' => 'level-1',
        'x' => 3000,
        'y' => 2000,
        'name' => 'Kitchen',
    ]);

    $response->assertOk()->assertSee('Kitchen');

    $room = collect($project->fresh()->document['elements'])
        ->firstWhere('kind', 'room');

    expect($room['number'])->toBe('101')
        ->and($room['p'])->toEqual(['x' => 3000, 'y' => 2000]);
});

test('a level stacks above the highest existing one by default', function () {
    $project = Project::factory()->create();

    $response = CadServer::tool(AddLevelTool::class, [
        'project_id' => $project->id,
        'name' => 'Level 3',
    ]);

    // The starter document tops out at the 6000 mm roof.
    $response->assertOk()->assertSee('9000');

    expect(collect($project->fresh()->document['levels'])->last()['name'])
        ->toBe('Level 3');
});

test('deleting a wall removes its hosted openings too', function () {
    $project = Project::factory()->withSampleResidence()->create();

    $elements = collect($project->document['elements']);
    $door = $elements->firstWhere('kind', 'door');
    $before = $elements->count();
    $hosted = $elements
        ->whereIn('kind', ['door', 'window'])
        ->where('host', $door['host'])
        ->count();

    $response = CadServer::tool(DeleteElementsTool::class, [
        'project_id' => $project->id,
        'element_ids' => [$door['host']],
    ]);

    $response->assertOk();

    expect(collect($project->fresh()->document['elements']))
        ->toHaveCount($before - 1 - $hosted);
});

test('deleting an unknown element id deletes nothing', function () {
    $project = Project::factory()->withSampleResidence()->create();
    $before = count($project->document['elements']);

    CadServer::tool(DeleteElementsTool::class, [
        'project_id' => $project->id,
        'element_ids' => ['not-a-real-id'],
    ])->assertHasErrors();

    expect($project->fresh()->document['elements'])->toHaveCount($before);
});

test('claude refuses to edit a drawing that lives on someone machine', function () {
    $project = Project::factory()->withSampleResidence()->create();
    $before = count($project->document['elements']);

    $project->forceFill(['has_local_model' => true])->save();

    // Editing the stored preview would be silently undone by the editor's
    // next save, so the tool says no rather than pretending.
    $response = CadServer::tool(CreateWallsTool::class, [
        'project_id' => $project->id,
        'level' => 'level-1',
        'walls' => [['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]]],
    ]);

    $response->assertHasErrors();

    expect($project->refresh()->document['elements'])->toHaveCount($before);
});

test('claude is told when it is looking at a preview rather than the model', function () {
    $project = Project::factory()->withSampleResidence()->create();

    CadServer::tool(GetDocumentTool::class, ['project_id' => $project->id])
        ->assertOk()
        ->assertSee('This is the whole model.');

    $project->forceFill(['has_local_model' => true])->save();

    CadServer::tool(GetDocumentTool::class, ['project_id' => $project->id])
        ->assertOk()
        ->assertSee('preview of one level');
});
