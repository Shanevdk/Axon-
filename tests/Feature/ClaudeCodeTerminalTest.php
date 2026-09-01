<?php

use App\Models\User;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Inertia\Testing\AssertableInertia;

/**
 * The JSON envelope `claude --print --output-format json` prints.
 */
function claudePrints(string $result, array $overrides = []): string
{
    return json_encode(array_replace([
        'type' => 'result',
        'subtype' => 'success',
        'is_error' => false,
        'session_id' => '6fe6b7d9-a8a0-47ce-8e77-e0837a7e1988',
        'result' => $result,
    ], $overrides));
}

/**
 * A well-formed terminal turn from Claude.
 */
function claudeTurn(array $turn): string
{
    return claudePrints(json_encode($turn));
}

beforeEach(function () {
    config()->set('services.claude_code.enabled', true);
    config()->set('services.claude_code.binary', 'claude');
    cache()->forget('claude-code:available');
});

test('guests cannot drive the CLI', function () {
    Process::fake();

    $this->post(route('library.claude'), ['prompt' => 'hello'])
        ->assertRedirect(route('login'));

    Process::assertNothingRan();
});

test('a turn runs the local CLI and comes back as talk plus a board', function () {
    Process::fake([
        '*' => Process::result(claudeTurn([
            'say' => 'here is a first pass.',
            'name' => 'Reading Chair',
            'parts' => [
                ['shape' => 'box', 'name' => 'Seat', 'width' => 900, 'depth' => 850, 'height' => 420],
            ],
        ])),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a reading chair'])
        ->assertOk()
        ->assertJsonPath('say', 'here is a first pass.')
        ->assertJsonPath('name', 'Reading Chair')
        ->assertJsonPath('parts.0.id', 'part-1')
        ->assertJsonPath('parts.0.name', 'Seat')
        ->assertJsonPath('session', '6fe6b7d9-a8a0-47ce-8e77-e0837a7e1988')
        ->assertJsonPath('refused', null);
});

test('the prompt and the board reach the CLI as arguments, never a shell string', function () {
    Process::fake(['*' => Process::result(claudeTurn(['say' => 'noted.']))]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), [
            'prompt' => 'make it wider',
            'parts' => [
                ['shape' => 'box', 'name' => 'Existing Seat', 'width' => 900,
                    'depth' => 850, 'height' => 420, 'x' => 0, 'y' => 0, 'z' => 0,
                    'rotation' => 0, 'id' => 'part-1'],
            ],
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        $command = $process->command;

        // A list, not a string: a prompt can never become a command.
        expect($command)->toBeArray()
            ->and($command[0])->toBe('claude')
            ->and($command)->toContain('--print')
            ->and($command)->toContain('make it wider')
            ->and($command)->toContain('--output-format')
            ->and($command)->toContain('json');

        $brief = $command[array_search('--append-system-prompt', $command, true) + 1];

        expect($brief)->toContain('Existing Seat')
            ->and($brief)->toContain('millimetres');

        return true;
    });
});

test('a session id is resumed so the conversation remembers', function () {
    Process::fake(['*' => Process::result(claudeTurn(['say' => 'still with you.']))]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), [
            'prompt' => 'and thinner arms',
            'session' => 'abc-123',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        expect($process->command)->toContain('--resume')
            ->and($process->command)->toContain('abc-123');

        return true;
    });
});

test('the first turn of a conversation resumes nothing', function () {
    Process::fake(['*' => Process::result(claudeTurn(['say' => 'hello.']))]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a stool'])
        ->assertOk();

    Process::assertRan(fn (PendingProcess $process): bool => ! in_array(
        '--resume',
        $process->command,
        true,
    ));
});

test('prose instead of the protocol still talks', function () {
    Process::fake([
        '*' => Process::result(claudePrints('thinking about that chair now')),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a chair'])
        ->assertOk()
        ->assertJsonPath('say', 'thinking about that chair now')
        ->assertJsonPath('parts', null);
});

test('unbuildable parts are refused but the talk survives', function () {
    Process::fake([
        '*' => Process::result(claudeTurn([
            'say' => 'behold my dodecahedron.',
            'parts' => [['shape' => 'dodecahedron', 'height' => 100]],
        ])),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'something impossible'])
        ->assertOk()
        ->assertJsonPath('say', 'behold my dodecahedron.')
        ->assertJsonPath('parts', null)
        ->assertJsonPath(
            'refused',
            'It offered parts the designer cannot build, so the board was left alone.',
        );
});

test('a CLI that is not installed says so in words a person can act on', function () {
    Process::fake([
        '*' => Process::result(
            output: '',
            errorOutput: "'claude' is not recognized as an internal or external command",
            exitCode: 1,
        ),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a chair'])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            'Claude Code is not installed on this machine, or not on the PATH. Install it, or set CLAUDE_CODE_BINARY to its full path.',
        );
});

test('a token the CLI will not accept says to mint a new one', function () {
    Process::fake([
        '*' => Process::result(
            output: '',
            errorOutput: 'Invalid API key · Please run /login',
            exitCode: 1,
        ),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a chair'])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            'Your Claude sign-in was refused — the token may have expired. Run `claude setup-token` again and reconnect your account.',
        );
});

test('an error the CLI reports in its envelope is passed on', function () {
    Process::fake([
        '*' => Process::result(claudePrints('ran out of turns', ['is_error' => true])),
    ]);

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a chair'])
        ->assertStatus(503)
        ->assertJsonPath('message', 'ran out of turns');
});

test('the CLI is refused outright where it is not the user’s own machine', function () {
    config()->set('services.claude_code.enabled', false);
    Process::fake();

    $this->actingAs(signedInUser())
        ->postJson(route('library.claude'), ['prompt' => 'a chair'])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            'Claude Code is not enabled on this server. It runs the CLI on the machine Vanhaven is served from, so it is for local use — set CLAUDE_CODE_ENABLED=true to allow it here.',
        );

    Process::assertNothingRan();
});

test('the designer reports the two halves of being ready separately', function () {
    Process::fake(['*' => Process::result('2.1.246')]);

    // Installed and signed in: the terminal can take a turn.
    $this->actingAs(signedInUser())
        ->get(route('library.designer'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('claude.installed', true)
            ->where('claude.signedIn', true)
            ->etc());

    // Installed, but nobody signed in. Telling this person to install what
    // they already have would send them the wrong way entirely.
    $this->actingAs(User::factory()->create())
        ->get(route('library.designer'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('claude.installed', true)
            ->where('claude.signedIn', false)
            ->etc());

    cache()->forget('claude-code:available');
    Process::fake(['*' => Process::result(output: '', errorOutput: 'nope', exitCode: 1)]);

    $this->actingAs(signedInUser())
        ->get(route('library.designer'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('claude.installed', false)
            ->where('claude.signedIn', true)
            ->etc());
});
