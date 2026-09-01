<?php

namespace App\Actions\Assistant;

use App\Concerns\AllowsTimeToAnswer;
use App\Models\ClaudeAccount;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * Puts a question to Claude Code on this machine and hands back the answer.
 *
 * The binary is here, but the account is not: every turn runs as the person
 * who asked for it, under the token they connected with `claude setup-token`.
 * That is how a Claude subscription designs furniture without an API key, and
 * why it is their subscription rather than the machine owner's. A turn cannot
 * be started without one — {@see handle()} takes the account first, so there
 * is no path through this class that borrows somebody else's plan.
 *
 * Arguments are passed as a list, never a shell string, so a prompt cannot
 * become a command. The token is passed as an environment variable, so it
 * never appears in a command line, a process list or a log.
 */
class RunClaudeCode
{
    use AllowsTimeToAnswer;

    /**
     * Asking the binary whether it exists costs about a second, so the answer
     * is kept for a while — installing Claude Code mid-session is rare.
     */
    private const AVAILABILITY_MINUTES = 10;

    /**
     * Whether the terminal may drive the CLI at all.
     *
     * Running a local binary only makes sense where the server is the user's
     * own computer. `CLAUDE_CODE_ENABLED` overrides the guess either way.
     */
    public function isEnabled(): bool
    {
        $configured = config('services.claude_code.enabled');

        if ($configured !== null && $configured !== '') {
            return filter_var($configured, FILTER_VALIDATE_BOOLEAN);
        }

        return app()->environment('local');
    }

    /**
     * Whether this person can take a turn: the binary is here, and they have
     * signed in with their own Claude account.
     *
     * Both halves are needed and they fail differently, which is why the
     * pages ask for each separately — "install it" and "sign in" are not the
     * same problem and must not read as the same message.
     */
    public function isReadyFor(?User $user): bool
    {
        return $user?->claudeAccount !== null && $this->isAvailable();
    }

    /**
     * Whether Claude Code is installed and answering.
     */
    public function isAvailable(): bool
    {
        if (! $this->isEnabled()) {
            return false;
        }

        return Cache::remember(
            'claude-code:available',
            now()->addMinutes(self::AVAILABILITY_MINUTES),
            function (): bool {
                $probe = Process::timeout(20)->run([
                    (string) config('services.claude_code.binary'),
                    '--version',
                ]);

                return $probe->successful();
            },
        );
    }

    /**
     * The name the MCP server is registered under for the length of a run.
     *
     * Claude Code addresses a tool as `mcp__<server>__<tool>`, so this prefix
     * is what every allowed tool name is built from.
     */
    public const SERVER = 'vanhaven';

    /**
     * Tools the CLI may never use on our behalf, whatever the person running
     * the app has allowed themselves in their own Claude settings.
     *
     * The app serves itself from a working copy of its own source. A chat
     * about a drawing has no business reading, writing or executing anything
     * on that machine — everything it needs arrives through MCP. Deny rules
     * win over allow rules, so this holds even against a permissive
     * `~/.claude/settings.json`.
     */
    private const FORBIDDEN = [
        'Bash', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep',
        'WebFetch', 'WebSearch', 'Task',
    ];

    /**
     * Ask, and get the text back.
     *
     * With `$tools` the run is given this application's own MCP server and
     * allowed to call the named tools on it — that is how the sidebar lets
     * Claude read and draw a model rather than only talk about one. Turns are
     * raised to suit, because a tool call and the answer about it are two.
     *
     * @param  ClaudeAccount  $account  whose plan the turn is drawn from
     * @param  list<string>  $tools  bare tool names, e.g. `get-document`
     * @return array{text: string, session: string|null}
     *
     * @throws RuntimeException when the CLI is missing, refuses, or says nothing
     */
    public function handle(
        ClaudeAccount $account,
        string $prompt,
        string $system,
        ?string $session = null,
        array $tools = [],
        int $turns = 1,
    ): array {
        if (! $this->isEnabled()) {
            throw new RuntimeException(
                'Claude Code is not enabled on this server. It runs the CLI on the machine Vanhaven is served from, so it is for local use — set CLAUDE_CODE_ENABLED=true to allow it here.'
            );
        }

        $command = [
            (string) config('services.claude_code.binary'),
            '--print',
            $prompt,
            '--output-format', 'json',
            // Bounded, so a stray tool call can never turn into a loop.
            '--max-turns', (string) max($turns, 1),
            '--append-system-prompt', $system,
        ];

        if ($tools !== []) {
            array_push(
                $command,
                '--mcp-config', $this->mcpConfig($account),
                // Only the server named above. Without this the CLI would
                // also load the repo's own .mcp.json, which points at tooling
                // that has nothing to do with drawing a building.
                '--strict-mcp-config',
                '--allowed-tools', implode(',', array_map(
                    fn (string $tool): string => sprintf('mcp__%s__%s', self::SERVER, $tool),
                    $tools,
                )),
                '--disallowed-tools', implode(',', self::FORBIDDEN),
            );
        }

        if ($session !== null && $session !== '') {
            array_push($command, '--resume', $session);
        }

        $result = Process::path(base_path())
            ->env($this->signedInAs($account))
            ->timeout($this->allowSecondsToAnswer(
                (int) config('services.claude_code.timeout'),
            ))
            ->run($command);

        if (! $result->successful()) {
            Log::warning('Claude Code refused a design turn.', [
                'exit' => $result->exitCode(),
            ]);

            throw new RuntimeException($this->reasonFor($result->errorOutput()));
        }

        $printed = json_decode(trim($result->output()), true);

        if (! is_array($printed)) {
            throw new RuntimeException(
                'Claude Code printed something unexpected. Run `claude` yourself once to check it is signed in.'
            );
        }

        if (($printed['is_error'] ?? false) === true) {
            throw new RuntimeException(
                is_string($printed['result'] ?? null) && trim($printed['result']) !== ''
                    ? trim($printed['result'])
                    : 'Claude Code could not finish that turn.',
            );
        }

        $text = $printed['result'] ?? null;

        if (! is_string($text) || trim($text) === '') {
            throw new RuntimeException('Claude Code came back empty. Try asking again.');
        }

        return [
            'text' => trim($text),
            'session' => is_string($printed['session_id'] ?? null)
                ? $printed['session_id']
                : null,
        ];
    }

    /**
     * Prove a token can actually answer, before it is saved.
     *
     * A sign-in that is not checked is not a sign-in — it is a text box that
     * accepts anything and fails later, somewhere else. This costs one very
     * short turn, which is a fair price for knowing.
     *
     * @throws RuntimeException with a message meant for the person signing in
     */
    public function verify(string $token): void
    {
        $this->handle(
            new ClaudeAccount(['token' => $token]),
            'Reply with the single word: connected.',
            'You are confirming a connection. Reply with one word and nothing else.',
        );
    }

    /**
     * The environment a turn runs in: signed in as the person who asked.
     *
     * Two things matter here. The token goes in the environment rather than
     * the command line, so it never shows up in a process list or a crash
     * log. And `ANTHROPIC_API_KEY` is blanked, because if the host happens to
     * have one exported the CLI would quietly use it — turning a turn that
     * should come out of somebody's subscription into a bill on the machine
     * owner's API account, which is the whole thing we are avoiding.
     *
     * Third, the CLI spawns our own MCP server as a subprocess, and a
     * subprocess has no session to read. `VANHAVEN_MCP_USER` is how it learns
     * whose work this turn may touch — without it the tools would fall back
     * to the unscoped local behaviour and show one studio another's drawings.
     *
     * @return array<string, string>
     */
    private function signedInAs(ClaudeAccount $account): array
    {
        return [
            'CLAUDE_CODE_OAUTH_TOKEN' => $account->token,
            'ANTHROPIC_API_KEY' => '',
            'VANHAVEN_MCP_USER' => (string) $account->user_id,
        ];
    }

    /**
     * A PHP that can run Artisan.
     *
     * `PHP_BINARY` is whatever is serving the request, and under a web server
     * that is not the CLI: Herd serves through `php-cgi.exe`, most Linux
     * hosts through `php-fpm`. Neither takes a script and arguments the way
     * the CLI does — `php-cgi artisan mcp:start cad` swallows the arguments
     * and exits — and the only symptom is the client saying the server failed
     * to connect, which points nowhere near the cause.
     *
     * So: an explicit setting if there is one, `PHP_BINARY` when it really is
     * the CLI (which is the case for the queue, the scheduler and tests), the
     * CLI sitting beside it otherwise, and `php` from the PATH as a last
     * resort.
     */
    private function phpBinary(): string
    {
        $configured = (string) config('services.claude_code.php');

        if ($configured !== '') {
            return $configured;
        }

        if (preg_match('/^php(\.exe)?$/i', basename(PHP_BINARY)) === 1) {
            return PHP_BINARY;
        }

        foreach (['php', 'php.exe'] as $sibling) {
            $beside = dirname(PHP_BINARY).DIRECTORY_SEPARATOR.$sibling;

            if (is_file($beside)) {
                return $beside;
            }
        }

        return 'php';
    }

    /**
     * This application, described to the CLI as an MCP server it can start.
     *
     * The same server `.mcp.json` gives to an outside client, addressed by
     * absolute path so it does not depend on where the CLI happens to be run
     * from, and started with the PHP that is already serving the app rather
     * than whatever `php` means on the host's PATH.
     */
    private function mcpConfig(ClaudeAccount $account): string
    {
        return (string) json_encode([
            'mcpServers' => [
                self::SERVER => [
                    'command' => $this->phpBinary(),
                    'args' => [base_path('artisan'), 'mcp:start', 'cad'],
                    // Named here as well as in the parent environment, because
                    // whether a spawned server inherits its parent's variables
                    // is the CLI's business, not ours. Without it the server
                    // cannot tell whose drawings this turn may touch.
                    'env' => ['VANHAVEN_MCP_USER' => (string) $account->user_id],
                ],
            ],
        ]);
    }

    /**
     * Turn a failed run into something worth showing a person.
     */
    private function reasonFor(string $errors): string
    {
        $said = trim($errors);

        if (str_contains($said, 'not recognized') || str_contains($said, 'not found')) {
            return 'Claude Code is not installed on this machine, or not on the PATH. Install it, or set CLAUDE_CODE_BINARY to its full path.';
        }

        if (
            stripos($said, 'login') !== false
            || stripos($said, 'auth') !== false
            || stripos($said, 'expired') !== false
            || stripos($said, 'invalid token') !== false
        ) {
            return 'Your Claude sign-in was refused — the token may have expired. Run `claude setup-token` again and reconnect your account.';
        }

        return $said !== ''
            ? mb_substr($said, 0, 400)
            : 'Claude Code could not be reached.';
    }
}
