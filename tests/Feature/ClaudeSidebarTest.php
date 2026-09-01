<?php

use App\Actions\Assistant\ModelBench;
use App\Mcp\Servers\CadServer;
use App\Mcp\Tools\CreateWallsTool;
use App\Models\Project;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;

/**
 * The JSON envelope `claude --print --output-format json` prints.
 */
function sidebarPrints(string $result, array $overrides = []): string
{
    return json_encode(array_replace([
        'type' => 'result',
        'subtype' => 'success',
        'is_error' => false,
        'session_id' => 'c0ffee00-1111-2222-3333-444455556666',
        'result' => $result,
    ], $overrides));
}

/**
 * A whole document, the shape the editor lends up.
 */
function lentDrawing(array $elements = []): array
{
    return [
        'version' => 1,
        'units' => 'metric',
        'levels' => [['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0]],
        'wallTypes' => [[
            'id' => 'wall-basic',
            'name' => 'Generic - 200',
            'thickness' => 200,
            'function' => 'interior',
        ]],
        'doorTypes' => [],
        'windowTypes' => [],
        'elements' => $elements,
        'viewSettings' => [],
    ];
}

beforeEach(function () {
    config()->set('services.claude_code.enabled', true);
    config()->set('services.claude_code.binary', 'claude');
    cache()->forget('claude-code:available');
});

test('guests cannot talk to the sidebar', function () {
    Process::fake();

    $project = Project::factory()->create();

    $this->post(route('projects.claude', $project), [
        'prompt' => 'hello',
        'mode' => 'ask',
    ])->assertRedirect(route('login'));

    Process::assertNothingRan();
});

test('a drawing belonging to another studio is out of reach', function () {
    Process::fake();

    $project = Project::factory()->create();

    $this->actingAs(signedInUser())
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'what is here?',
            'mode' => 'ask',
        ])
        ->assertForbidden();

    Process::assertNothingRan();
});

test('asking runs the CLI holding this application as an MCP server', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Two walls and a room.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->withSampleResidence()->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'what is in this model?',
            'mode' => 'ask',
        ])
        ->assertOk()
        ->assertJsonPath('text', 'Two walls and a room.')
        ->assertJsonPath('session', 'c0ffee00-1111-2222-3333-444455556666')
        ->assertJsonPath('changes', [])
        ->assertJsonPath('document', null);

    Process::assertRan(function (PendingProcess $process): bool {
        $command = $process->command;

        // A list, not a string: the prompt can never become a command.
        expect($command)->toBeArray()->and($command[0])->toBe('claude');

        $config = $command[array_search('--mcp-config', $command, true) + 1];
        $server = json_decode($config, true)['mcpServers']['vanhaven'];

        expect($server['args'])->toContain('mcp:start')
            ->and($server['args'])->toContain('cad')
            // Only our server: the repo's own .mcp.json must not be loaded.
            ->and($command)->toContain('--strict-mcp-config');

        return true;
    });
});

test('the drawing tools are started with a PHP that can run artisan', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Right.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'hello',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        $config = $process->command[
            array_search('--mcp-config', $process->command, true) + 1
        ];
        $php = basename(json_decode($config, true)['mcpServers']['vanhaven']['command']);

        // Serving PHP is not CLI PHP. Herd runs php-cgi and most Linux hosts
        // run php-fpm; hand either of them `artisan mcp:start cad` and the
        // arguments are swallowed, the server never starts, and the only
        // thing anybody sees is "the vanhaven MCP server failed to connect".
        expect($php)->not->toContain('cgi')
            ->and($php)->not->toContain('fpm')
            ->and($php)->toMatch('/^php(\.exe)?$/i');

        return true;
    });
});

test('an explicitly configured PHP is used as given', function () {
    config()->set('services.claude_code.php', '/opt/php/8.4/bin/php');

    Process::fake(['*' => Process::result(sidebarPrints('Right.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'hello',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        $config = $process->command[
            array_search('--mcp-config', $process->command, true) + 1
        ];

        expect(json_decode($config, true)['mcpServers']['vanhaven']['command'])
            ->toBe('/opt/php/8.4/bin/php');

        return true;
    });
});

test('asking is given the reading tools and no others', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Nothing built yet.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'anything here?',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        $allowed = $process->command[
            array_search('--allowed-tools', $process->command, true) + 1
        ];

        // Ask cannot draw however it is asked to — the tool simply is not
        // there to call.
        expect($allowed)->toContain('mcp__vanhaven__get-document')
            ->and($allowed)->not->toContain('create-walls')
            ->and($allowed)->not->toContain('delete-elements');

        return true;
    });
});

test('the shell and the filesystem are refused whatever the host has allowed', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Right.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'read my source code',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        $denied = $process->command[
            array_search('--disallowed-tools', $process->command, true) + 1
        ];

        // The app serves itself out of a working copy of its own source. A
        // conversation about a drawing has no business reaching it.
        expect($denied)->toContain('Bash')
            ->and($denied)->toContain('Write')
            ->and($denied)->toContain('Read');

        return true;
    });
});

test('building lends the live drawing and takes back what was drawn', function () {
    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    // The drawing lives on this person's machine, so the server's copy is a
    // preview. The sidebar hands the real one over for the length of the turn.
    $project->forceFill(['has_local_model' => true])->save();
    $stored = $project->document;

    // Standing in for Claude: while the bench is open, the MCP tools reach the
    // lent drawing exactly as they would reach a stored one.
    Process::fake(['*' => function () use ($project) {
        CadServer::tool(CreateWallsTool::class, [
            'project_id' => $project->id,
            'level' => 'level-1',
            'walls' => [
                ['a' => ['x' => 0, 'y' => 0], 'b' => ['x' => 6000, 'y' => 0]],
                ['a' => ['x' => 6000, 'y' => 0], 'b' => ['x' => 6000, 'y' => 4000]],
            ],
        ]);

        return Process::result(sidebarPrints('Drawn — two walls on Level 1.'));
    }]);

    $response = $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'draw two walls',
            'mode' => 'build',
            'document' => lentDrawing(),
        ])
        ->assertOk()
        ->assertJsonPath('changes', ['2 walls added']);

    $returned = $response->json('document');

    expect($returned['elements'])->toHaveCount(2)
        ->and($returned['elements'][0]['kind'])->toBe('wall')
        ->and($returned['elements'][0]['b']['x'])->toEqual(6000);

    // The preview on the server is untouched: the browser owns the drawing
    // and will save it itself.
    expect($project->refresh()->document)->toEqual($stored);
});

test('the bench is cleared once the turn is over', function () {
    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    Process::fake(['*' => Process::result(sidebarPrints('Nothing to do.'))]);

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'have a look',
            'mode' => 'build',
            'document' => lentDrawing(),
        ])
        ->assertOk();

    expect(app(ModelBench::class)->isOpen($project->id))->toBeFalse();
});

test('a turn that failed leaves nothing behind on the bench', function () {
    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    Process::fake(['*' => Process::result(
        exitCode: 1,
        errorOutput: 'Invalid API key · Please run /login',
    )]);

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'draw a wall',
            'mode' => 'build',
            'document' => lentDrawing(),
        ])
        ->assertStatus(503)
        ->assertJsonPath('message', fn (string $said): bool => str_contains($said, 'setup-token'));

    expect(app(ModelBench::class)->isOpen($project->id))->toBeFalse();
});

test('a turn that changed nothing costs the editor no undo entry', function () {
    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    Process::fake(['*' => Process::result(sidebarPrints('That is already how it is drawn.'))]);

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'make the walls 200 thick',
            'mode' => 'build',
            'document' => lentDrawing(),
        ])
        ->assertOk()
        ->assertJsonPath('changes', [])
        ->assertJsonPath('document', null);
});

test('building without the drawing is refused rather than built on a preview', function () {
    Process::fake();

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'draw a wall',
            'mode' => 'build',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('document');

    Process::assertNothingRan();
});

test('the conversation is carried on by session id', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Still with you.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'and a window in it',
            'mode' => 'ask',
            'session' => 'abc-123',
        ])
        ->assertOk();

    Process::assertRan(fn (PendingProcess $process): bool => in_array('--resume', $process->command, true)
        && in_array('abc-123', $process->command, true));
});

test('the brief tells claude which project it is on and what a length means', function () {
    Process::fake(['*' => Process::result(sidebarPrints('Understood.'))]);

    $user = signedInUser();
    $project = Project::factory()->for($user)->create([
        'name' => 'Kitsilano Laneway',
        'jurisdiction' => 'Vancouver, British Columbia',
    ]);

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'hello',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process) use ($project): bool {
        $brief = $process->command[
            array_search('--append-system-prompt', $process->command, true) + 1
        ];

        expect($brief)->toContain('Kitsilano Laneway')
            ->and($brief)->toContain((string) $project->id)
            ->and($brief)->toContain('Vancouver, British Columbia')
            ->and($brief)->toContain('MILLIMETRES')
            ->and($brief)->toContain('read-only');

        return true;
    });
});

test('a drawing too large to move is refused with a reason', function () {
    Process::fake();

    $user = signedInUser();
    $project = Project::factory()->for($user)->create();

    // An imported mesh is what makes a document enormous, so that is what is
    // used to build one past the limit.
    $huge = lentDrawing([[
        'id' => 'mesh-1',
        'kind' => 'mesh',
        'level' => 'level-1',
        'vertices' => array_fill(0, ModelBench::MAX_BYTES / 4, 1234.5678),
    ]]);

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'tidy this up',
            'mode' => 'build',
            'document' => $huge,
        ])
        ->assertStatus(503)
        ->assertJsonPath('message', fn (string $said): bool => str_contains($said, 'too large'));

    Process::assertNothingRan();
});
