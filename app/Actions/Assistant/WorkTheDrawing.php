<?php

namespace App\Actions\Assistant;

use App\Actions\Projects\BuildStarterDocument;
use App\Models\ClaudeAccount;
use App\Models\Project;
use RuntimeException;

/**
 * The editor sidebar's turn with Claude.
 *
 * This is the same CLI transport the item designer's terminal uses, given a
 * different brief and — the point of it — this application's own MCP server,
 * so the answer can be a drawn wall rather than a description of one.
 *
 * A turn has two shapes. Asking is read-only: Claude may look at the model
 * and say what it sees, and nothing can change. Building lends the live
 * drawing to a {@see ModelBench}, opens the writing tools, and hands whatever
 * comes back to the browser as one undoable change. Which tools exist is the
 * whole of the difference — there is no honour system.
 */
class WorkTheDrawing
{
    /** Tools that only look. */
    public const READING = [
        'list-projects',
        'get-document',
        'list-library-items',
        'get-library-item',
    ];

    /** Tools that change the model, added on top of the reading ones. */
    public const WRITING = [
        'create-walls',
        'place-opening',
        'place-room',
        'add-level',
        'delete-elements',
        'design-library-item',
    ];

    /**
     * How many turns each mode gets.
     *
     * Reading is a look and an answer. Building is a look, a run of edits and
     * an answer, and a house is drawn a few walls at a time — but the ceiling
     * is what stops a confused turn grinding for ten minutes.
     */
    private const TURNS = ['ask' => 6, 'build' => 14];

    public function __construct(
        private ModelBench $bench,
        private RunClaudeCode $claude,
    ) {}

    /**
     * Take one turn.
     *
     * @param  ClaudeAccount  $account  whose plan this turn is drawn from
     * @param  array<string, mixed>|null  $document  the live drawing, when building
     * @return array{text: string, session: string|null, changes: list<string>, document: array<string, mixed>|null}
     *
     * @throws RuntimeException when the drawing is too big or the CLI fails
     */
    public function handle(
        ClaudeAccount $account,
        Project $project,
        string $prompt,
        string $mode,
        ?array $document = null,
        ?string $session = null,
    ): array {
        $building = $mode === 'build';

        if (! $building) {
            $answer = $this->claude->handle(
                $account,
                $prompt,
                $this->brief($project, false),
                $session,
                self::READING,
                self::TURNS['ask'],
            );

            return [...$answer, 'changes' => [], 'document' => null];
        }

        if ($document === null) {
            throw new RuntimeException(
                'The drawing did not come with that request, so there was nothing to build on. Reload the editor and try again.'
            );
        }

        if (! $this->bench->fits($document)) {
            throw new RuntimeException(
                'This model is too large to hand over — imported meshes make it bigger than the sidebar can move. Ask about it instead, or draw this part by hand.'
            );
        }

        // Healed before it goes on the bench, because that is what the tools
        // read it as. Diffing against the raw copy instead would report the
        // backfilled type catalogues as work Claude did, which it did not.
        $lent = app(BuildStarterDocument::class)->normalize($document);

        $this->bench->lend($project, $lent);

        try {
            $answer = $this->claude->handle(
                $account,
                $prompt,
                $this->brief($project, true),
                $session,
                [...self::READING, ...self::WRITING],
                self::TURNS['build'],
            );
        } finally {
            // Cleared in the same request that opened it, whatever happened.
            // A turn that failed part way through throws from here, so its
            // half-finished work is collected and dropped rather than sent
            // back — nobody wants three of the four walls they asked for.
            $worked = $this->bench->collect($project->id);
        }

        $changes = $worked === null ? [] : $this->changes($lent, $worked);

        return [
            ...$answer,
            'changes' => $changes,
            // Only worth sending back if it is actually different; an answer
            // that drew nothing should not cost the editor an undo entry.
            'document' => $changes === [] ? null : $worked,
        ];
    }

    /**
     * What is different between the drawing lent out and the one that came
     * back, in the words the sidebar shows.
     *
     * This is read off the two documents rather than off what Claude says it
     * did, because those are not always the same thing.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return list<string>
     */
    public function changes(array $before, array $after): array
    {
        $said = [];

        foreach ($this->countByKind($before, $after) as $line) {
            $said[] = $line;
        }

        $levels = count($after['levels'] ?? []) - count($before['levels'] ?? []);

        if ($levels > 0) {
            $said[] = $this->count($levels, 'level', 'levels').' added';
        }

        foreach (['wallTypes' => 'wall type', 'doorTypes' => 'door type', 'windowTypes' => 'window type'] as $key => $noun) {
            $gained = count($after[$key] ?? []) - count($before[$key] ?? []);

            if ($gained > 0) {
                $said[] = $this->count($gained, $noun, $noun.'s').' added';
            }
        }

        return $said;
    }

    /**
     * Elements gained, lost and altered, one line per kind.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return list<string>
     */
    private function countByKind(array $before, array $after): array
    {
        $was = $this->byId($before);
        $now = $this->byId($after);

        /** @var array<string, array{added: int, removed: int, changed: int}> $tally */
        $tally = [];

        foreach ($now as $id => $element) {
            $kind = (string) ($element['kind'] ?? 'element');
            $tally[$kind] ??= ['added' => 0, 'removed' => 0, 'changed' => 0];

            if (! array_key_exists($id, $was)) {
                $tally[$kind]['added']++;
            } elseif ($was[$id] !== $element) {
                $tally[$kind]['changed']++;
            }
        }

        foreach ($was as $id => $element) {
            if (array_key_exists($id, $now)) {
                continue;
            }

            $kind = (string) ($element['kind'] ?? 'element');
            $tally[$kind] ??= ['added' => 0, 'removed' => 0, 'changed' => 0];
            $tally[$kind]['removed']++;
        }

        ksort($tally);

        $said = [];

        foreach ($tally as $kind => $counts) {
            foreach (['added', 'removed', 'changed'] as $what) {
                if ($counts[$what] > 0) {
                    $said[] = $this->count($counts[$what], $kind, $this->plural($kind)).' '.$what;
                }
            }
        }

        return $said;
    }

    /**
     * @param  array<string, mixed>  $document
     * @return array<string, array<string, mixed>>
     */
    private function byId(array $document): array
    {
        $held = [];

        foreach ($document['elements'] ?? [] as $element) {
            if (is_array($element) && is_string($element['id'] ?? null)) {
                $held[$element['id']] = $element;
            }
        }

        return $held;
    }

    private function count(int $many, string $one, string $more): string
    {
        return $many.' '.($many === 1 ? $one : $more);
    }

    private function plural(string $kind): string
    {
        return match ($kind) {
            'stairs' => 'stairs',
            default => $kind.'s',
        };
    }

    /**
     * What Claude is told before it hears the question.
     *
     * Everything here is the standing brief. What the model contains is not:
     * Claude reads that itself with `get-document`, which is both cheaper and
     * always current.
     */
    private function brief(Project $project, bool $building): string
    {
        $where = $project->jurisdiction !== null && $project->jurisdiction !== ''
            ? $project->jurisdiction
            : 'not recorded';

        $mode = $building
            ? <<<'MARKDOWN'
                You may change this drawing. The person is watching: whatever you
                draw appears in their editor as a single change they can undo.

                - Call `get-document` before your first edit, every turn. Use the
                  level ids, type ids and element ids you find there; never guess one.
                - Prefer few large calls to many small ones — `create-walls` takes a
                  list, so a room is one call, not four.
                - Make the change you were asked for and stop. Do not tidy, rename or
                  improve anything you were not asked about.
                - If the request is ambiguous in a way that matters, ask instead of
                  picking for them. A wrong wall costs more than a question.
                MARKDOWN
            : <<<'MARKDOWN'
                This turn is read-only. You can look at the model but you cannot
                change it, and you should not offer to — if they want something
                drawn, tell them to switch the sidebar to Build.
                MARKDOWN;

        return <<<MARKDOWN
            You are answering inside Vanhaven Design Software, an architectural
            drawing program. Your reply appears in a narrow sidebar beside the
            drawing, so keep it short: a couple of sentences, or a few bullets.
            No preamble, no restating the question, no markdown headings.

            You are working on one project and only that one:
            - id {$project->id}, "{$project->name}"
            - displayed in {$project->units} units
            - being built in: {$where}

            Every length you send or read is in MILLIMETRES, whatever the project
            displays. Plan coordinates are x east, y north. Never send feet, inches
            or metres.

            {$mode}

            When you talk about sizes, use the units the project displays, even
            though you work in millimetres.

            If you are asked about building code, say what the code generally
            requires and name the authority having jurisdiction that has the final
            say. Never invent a clause number. If you do not know the code where
            this building is, say so.
            MARKDOWN;
    }
}
