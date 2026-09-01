<?php

use App\Mcp\Servers\CadServer;
use App\Mcp\Tools\CreateWallsTool;
use App\Mcp\Tools\DesignLibraryItemTool;
use App\Mcp\Tools\GetDocumentTool;
use App\Mcp\Tools\GetLibraryItemTool;
use App\Mcp\Tools\ListLibraryItemsTool;
use App\Mcp\Tools\ListProjectsTool;
use App\Models\LibraryItem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Laravel\Passport\Passport;

/**
 * Two studios who have never met, each with a building.
 *
 * @return array{0: User, 1: User, 2: Project, 3: Project}
 */
function twoStudios(): array
{
    $mine = User::factory()->for(Organization::factory())->create();
    $theirs = User::factory()->for(Organization::factory())->create();

    return [
        $mine,
        $theirs,
        Project::factory()->for($mine)->withSampleResidence()->create(['name' => 'My Laneway House']),
        Project::factory()->for($theirs)->withSampleResidence()->create(['name' => 'Their Beach House']),
    ];
}

/* --------------------------------------------------- one studio at a time */

test('listing projects shows the asker their own studio and nobody else', function () {
    [$mine, , $ours, $theirs] = twoStudios();

    $response = CadServer::actingAs($mine)->tool(ListProjectsTool::class);

    $response->assertOk()
        ->assertSee($ours->name)
        ->assertDontSee($theirs->name);
});

test('a teammate sees the whole studio, because joining the team is joining the work', function () {
    $studio = Organization::factory()->create();
    $mine = User::factory()->for($studio)->create();
    $colleague = User::factory()->for($studio)->create();

    $theirs = Project::factory()->for($colleague)->create(['name' => 'Kitsilano Laneway']);

    CadServer::actingAs($mine)->tool(ListProjectsTool::class)
        ->assertOk()
        ->assertSee($theirs->name);
});

test('another studio drawing cannot be read even when its id is known', function () {
    [$mine, , , $theirs] = twoStudios();

    CadServer::actingAs($mine)
        ->tool(GetDocumentTool::class, ['project_id' => $theirs->id])
        ->assertHasErrors();
});

test('another studio drawing cannot be built in', function () {
    [$mine, , , $theirs] = twoStudios();
    $before = count($theirs->document['elements']);

    CadServer::actingAs($mine)
        ->tool(CreateWallsTool::class, [
            'project_id' => $theirs->id,
            'level' => 'level-1',
            'walls' => [['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]]],
        ])
        ->assertHasErrors();

    expect($theirs->refresh()->document['elements'])->toHaveCount($before);
});

test('a project that does not exist reads exactly like one that is not yours', function () {
    [$mine, , , $theirs] = twoStudios();

    // The same words either way. Two different messages would let a caller
    // map the database by asking for every id in turn and watching which
    // answer comes back.
    $said = 'No project with that id is open to you.';

    CadServer::actingAs($mine)
        ->tool(GetDocumentTool::class, ['project_id' => 99999])
        ->assertHasErrors()
        ->assertSee($said);

    CadServer::actingAs($mine)
        ->tool(GetDocumentTool::class, ['project_id' => $theirs->id])
        ->assertHasErrors()
        ->assertSee($said);
});

/* --------------------------------------------------------- the shelf too */

test('the library shelf is the studio own', function () {
    [$mine, $theirs] = twoStudios();

    LibraryItem::factory()->for($mine)->create(['name' => 'Our Reading Chair']);
    $hidden = LibraryItem::factory()->for($theirs)->create(['name' => 'Their Sideboard']);

    CadServer::actingAs($mine)->tool(ListLibraryItemsTool::class)
        ->assertOk()
        ->assertSee('Our Reading Chair')
        ->assertDontSee('Their Sideboard');

    CadServer::actingAs($mine)
        ->tool(GetLibraryItemTool::class, ['item_id' => $hidden->id])
        ->assertHasErrors();
});

test('a designed item belongs to whoever designed it', function () {
    [$mine, $theirs] = twoStudios();

    // Before scoping this fell to `User::query()->orderBy('id')->first()`,
    // which put everybody's furniture on the oldest account's shelf.
    expect($theirs->id)->toBeGreaterThan($mine->id);

    CadServer::actingAs($theirs)->tool(DesignLibraryItemTool::class, [
        'name' => 'Their Stool',
        'parts' => [[
            'shape' => 'box', 'name' => 'Seat',
            'width' => 400, 'depth' => 400, 'height' => 60,
        ]],
    ])->assertOk();

    expect(LibraryItem::query()->where('name', 'Their Stool')->value('user_id'))
        ->toBe($theirs->id);
});

/* ------------------------------------------------------- the way in */

test('the connector is closed to anyone without a token', function () {
    $this->postJson('/mcp/cad', [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/list',
    ])->assertUnauthorized();
});

test('a refusal points the client at where to ask for a token', function () {
    // Without this header a client has no way to discover the authorization
    // server, and the connection fails as "couldn't reach the MCP server".
    $response = $this->postJson('/mcp/cad', [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/list',
    ]);

    expect($response->headers->get('WWW-Authenticate'))
        ->toContain('Bearer')
        ->toContain('resource_metadata');
});

test('a token gets in and sees only its own studio', function () {
    [$mine, , $ours, $theirs] = twoStudios();

    Passport::actingAs($mine, ['mcp:use']);

    $response = $this->postJson('/mcp/cad', [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/call',
        'params' => ['name' => 'list-projects', 'arguments' => []],
    ], ['Accept' => 'application/json, text/event-stream']);

    $response->assertOk();

    expect($response->getContent())->toContain($ours->name)
        ->and($response->getContent())->not->toContain($theirs->name);
});

/* ----------------------------------------------------------- discovery */

test('the protected resource document points at this application', function () {
    $this->getJson('/.well-known/oauth-protected-resource')
        ->assertOk()
        ->assertJsonStructure(['resource', 'authorization_servers']);
});

test('the authorization server advertises PKCE and the codes Claude needs', function () {
    $metadata = $this->getJson('/.well-known/oauth-authorization-server')
        ->assertOk()
        ->json();

    // Claude sends a code_challenge on every authorization request and checks
    // for S256 support before starting, so a server that does not advertise
    // it never gets asked.
    expect($metadata['code_challenge_methods_supported'])->toContain('S256')
        ->and($metadata['grant_types_supported'])->toContain('authorization_code')
        ->and($metadata['grant_types_supported'])->toContain('refresh_token')
        ->and($metadata)->toHaveKey('registration_endpoint');
});

test('a client can register itself, because that is how Claude arrives', function () {
    // Claude has no account here and nobody types a client id into it: it
    // registers on first connection and gets its own credentials.
    $this->postJson('/oauth/register', [
        'client_name' => 'Claude',
        'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback'],
        'grant_types' => ['authorization_code', 'refresh_token'],
    ])
        ->assertCreated()
        ->assertJsonStructure(['client_id', 'redirect_uris', 'grant_types'])
        // A public client authenticating with PKCE alone: Claude is a native
        // and browser client, so there is nowhere safe to keep a secret.
        ->assertJsonPath('token_endpoint_auth_method', 'none')
        ->assertJsonPath('scope', 'mcp:use');
});
