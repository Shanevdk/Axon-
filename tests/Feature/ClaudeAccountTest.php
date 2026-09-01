<?php

use App\Models\ClaudeAccount;
use App\Models\Project;
use App\Models\User;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;

/**
 * The JSON envelope `claude --print --output-format json` prints.
 */
function accountPrints(string $result): string
{
    return json_encode([
        'type' => 'result',
        'subtype' => 'success',
        'is_error' => false,
        'session_id' => 'aaaa1111-2222-3333-4444-555566667777',
        'result' => $result,
    ]);
}

beforeEach(function () {
    config()->set('services.claude_code.enabled', true);
    config()->set('services.claude_code.binary', 'claude');
    cache()->forget('claude-code:available');
});

/* ------------------------------------------------------------ signing in */

test('a token is proved before it is kept', function () {
    Process::fake(['*' => Process::result(accountPrints('connected.'))]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('claude-account.store'), ['token' => str_repeat('a', 40)])
        ->assertRedirect();

    expect($user->refresh()->claudeAccount)->not->toBeNull()
        ->and($user->claudeAccount->token)->toBe(str_repeat('a', 40))
        ->and($user->claudeAccount->verified_at)->not->toBeNull();

    // The proving turn actually ran; it is not a stored-and-hoped sign-in.
    Process::assertRan(fn (PendingProcess $process): bool => in_array('--print', $process->command, true));
});

test('a token the CLI refuses is not saved', function () {
    Process::fake(['*' => Process::result(
        exitCode: 1,
        errorOutput: 'OAuth token expired',
    )]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->from(route('library.designer'))
        ->post(route('claude-account.store'), ['token' => str_repeat('b', 40)])
        ->assertRedirect(route('library.designer'))
        ->assertSessionHasErrors('token');

    // Nothing kept, so the page keeps asking rather than failing later.
    expect($user->refresh()->claudeAccount)->toBeNull();
});

test('signing in again replaces the token rather than collecting them', function () {
    Process::fake(['*' => Process::result(accountPrints('connected.'))]);

    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create(['token' => 'old-token-value']);

    $this->actingAs($user)
        ->post(route('claude-account.store'), ['token' => str_repeat('c', 40)]);

    expect(ClaudeAccount::query()->where('user_id', $user->id)->count())->toBe(1)
        ->and($user->refresh()->claudeAccount->token)->toBe(str_repeat('c', 40));
});

test('signing out deletes the token', function () {
    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create();

    $this->actingAs($user)
        ->delete(route('claude-account.destroy'))
        ->assertRedirect();

    expect($user->refresh()->claudeAccount)->toBeNull();
});

test('the token is never sent back to the browser', function () {
    $user = User::factory()->create();
    $account = ClaudeAccount::factory()->for($user)->create();

    expect($account->toArray())->not->toHaveKey('token')
        ->and(json_encode($account))->not->toContain('sk-ant-oat');
});

test('the token is encrypted at rest', function () {
    $account = ClaudeAccount::factory()->create(['token' => 'sk-ant-oat01-secret']);

    $stored = DB::table('claude_accounts')->where('id', $account->id)->value('token');

    expect($stored)->not->toContain('sk-ant-oat01-secret');
});

/* ------------------------------------------------------------- the gates */

test('the sidebar refuses anyone who has not signed in to claude', function () {
    Process::fake();

    $user = User::factory()->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'what is here?',
            'mode' => 'ask',
        ])
        ->assertForbidden()
        ->assertJsonPath('message', fn (string $said): bool => str_contains($said, 'Sign in with your Claude account'));

    // No account, no turn: nobody else's plan gets spent.
    Process::assertNothingRan();
});

test('the designer terminal refuses anyone who has not signed in to claude', function () {
    Process::fake();

    $this->actingAs(User::factory()->create())
        ->postJson(route('library.claude'), ['prompt' => 'a stool'])
        ->assertForbidden();

    Process::assertNothingRan();
});

/* ------------------------------------------------------ whose plan it is */

test('a turn runs under the token of the person who asked', function () {
    Process::fake(['*' => Process::result(accountPrints('Two walls.'))]);

    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create(['token' => 'sk-ant-oat01-mine']);

    // Somebody else, signed in with their own. Their plan must not be touched.
    ClaudeAccount::factory()->for(User::factory()->create())
        ->create(['token' => 'sk-ant-oat01-theirs']);

    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'what is here?',
            'mode' => 'ask',
        ])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        expect($process->environment['CLAUDE_CODE_OAUTH_TOKEN'])
            ->toBe('sk-ant-oat01-mine');

        return true;
    });
});

test('the token travels as environment, never on the command line', function () {
    Process::fake(['*' => Process::result(accountPrints('Right.'))]);

    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create(['token' => 'sk-ant-oat01-secret']);

    $this->actingAs($user)
        ->postJson(route('library.claude'), ['prompt' => 'a stool'])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        // A command line shows up in process lists and crash logs.
        expect(implode(' ', $process->command))->not->toContain('sk-ant-oat01-secret')
            ->and($process->environment['CLAUDE_CODE_OAUTH_TOKEN'])->toBe('sk-ant-oat01-secret');

        return true;
    });
});

test('a host API key cannot quietly take over the billing', function () {
    Process::fake(['*' => Process::result(accountPrints('Right.'))]);

    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('library.claude'), ['prompt' => 'a stool'])
        ->assertOk();

    Process::assertRan(function (PendingProcess $process): bool {
        // If the machine has ANTHROPIC_API_KEY exported, the CLI would use it
        // and bill the host's API account instead of the asker's plan.
        expect($process->environment['ANTHROPIC_API_KEY'])->toBe('');

        return true;
    });
});

test('an expired token is explained rather than shrugged at', function () {
    Process::fake(['*' => Process::result(
        exitCode: 1,
        errorOutput: 'OAuth token has expired',
    )]);

    $user = User::factory()->create();
    ClaudeAccount::factory()->for($user)->create();
    $project = Project::factory()->for($user)->create();

    $this->actingAs($user)
        ->postJson(route('projects.claude', $project), [
            'prompt' => 'what is here?',
            'mode' => 'ask',
        ])
        ->assertStatus(503)
        ->assertJsonPath('message', fn (string $said): bool => str_contains($said, 'setup-token'));
});
