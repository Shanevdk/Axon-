<?php

namespace App\Actions\Assistant;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * Puts a question to Claude Code on this machine and hands back the answer.
 *
 * The CLI is already signed in to whatever plan the person pays for, so this
 * is how a Claude subscription designs furniture without an API key: the app
 * runs `claude -p` in print mode, reads the JSON it prints, and carries the
 * session id forward so the conversation continues turn to turn.
 *
 * Arguments are passed as a list, never a shell string, so a prompt cannot
 * become a command.
 */
class RunClaudeCode
{
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
     * Ask, and get the text back.
     *
     * @return array{text: string, session: string|null}
     *
     * @throws RuntimeException when the CLI is missing, refuses, or says nothing
     */
    public function handle(string $prompt, string $system, ?string $session = null): array
    {
        if (! $this->isEnabled()) {
            throw new RuntimeException(
                'Claude Code is not enabled on this server. It runs the CLI on the machine Axon is served from, so it is for local use — set CLAUDE_CODE_ENABLED=true to allow it here.'
            );
        }

        $command = [
            (string) config('services.claude_code.binary'),
            '--print',
            $prompt,
            '--output-format', 'json',
            // One turn, so a stray tool call can never turn into a loop.
            '--max-turns', '1',
            '--append-system-prompt', $system,
        ];

        if ($session !== null && $session !== '') {
            array_push($command, '--resume', $session);
        }

        $result = Process::path(base_path())
            ->timeout((int) config('services.claude_code.timeout'))
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
     * Turn a failed run into something worth showing a person.
     */
    private function reasonFor(string $errors): string
    {
        $said = trim($errors);

        if (str_contains($said, 'not recognized') || str_contains($said, 'not found')) {
            return 'Claude Code is not installed on this machine, or not on the PATH. Install it, or set CLAUDE_CODE_BINARY to its full path.';
        }

        if (stripos($said, 'login') !== false || stripos($said, 'auth') !== false) {
            return 'Claude Code is not signed in. Run `claude` in a terminal once and log in, then try again.';
        }

        return $said !== ''
            ? mb_substr($said, 0, 400)
            : 'Claude Code could not be reached.';
    }
}
