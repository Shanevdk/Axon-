<?php

namespace App\Mcp\Tools\Concerns;

use App\Actions\Assistant\ModelBench;
use App\Actions\Projects\BuildStarterDocument;
use App\Models\Project;
use Illuminate\Support\Str;
use Laravel\Mcp\Response;

/**
 * Shared plumbing for tools that read or write a project's model document.
 *
 * Documents are normalized on the way in — the same healing the editor gets —
 * so a tool can rely on the type catalogues existing. Every length is in
 * millimetres, matching the document convention.
 *
 * There are two places a document can be. Normally it is the `document`
 * column. But when somebody is talking to Claude in the editor's sidebar,
 * their browser has lent the live drawing to a `ModelBench` for the length of
 * the turn — and that copy, not the column, is the truth. All three seams
 * below check the bench first so every tool follows the drawing without
 * knowing the sidebar exists.
 */
trait MutatesDocuments
{
    use ScopesToTheAsker;

    /**
     * Refuse to touch a project whose model lives on someone's machine.
     *
     * Once a drawing is local the server keeps only a one-level preview, and
     * the editor overwrites that preview on its next save. Editing it here
     * would look like it worked and then quietly vanish, so it is stopped.
     *
     * Unless it is on the bench: then the browser handed the whole model over
     * itself and is waiting to take the result back, so there is nothing to
     * lose and the edit goes ahead.
     */
    protected function refuseIfAway(Project $project): ?Response
    {
        if (! $project->has_local_model || $this->bench()->isOpen($project->id)) {
            return null;
        }

        return Response::error(sprintf(
            'The model for "%s" is held on the computer that drew it — the server keeps only a preview, '
            .'so it cannot be edited from here. Open the project in Vanhaven on that machine, or use '
            .'Download drawing to move it.',
            $project->name,
        ));
    }

    /**
     * @return array<string, mixed>
     */
    protected function documentFor(Project $project): array
    {
        $lent = $this->bench()->borrowed($project->id);

        return app(BuildStarterDocument::class)->normalize($lent ?? $project->document);
    }

    /**
     * @param  array<string, mixed>  $document
     */
    protected function saveDocument(Project $project, array $document): void
    {
        $bench = $this->bench();

        if ($bench->isOpen($project->id)) {
            $bench->put($project->id, $document);

            return;
        }

        $project->update(['document' => $document]);
    }

    protected function bench(): ModelBench
    {
        return app(ModelBench::class);
    }

    protected function elementId(string $prefix): string
    {
        return sprintf('%s-%s', $prefix, Str::lower(Str::random(10)));
    }

    /**
     * @param  array<string, mixed>  $document
     */
    protected function levelExists(array $document, string $level): bool
    {
        return collect($document['levels'])->contains(
            fn (array $item): bool => $item['id'] === $level,
        );
    }

    /**
     * @param  array<string, mixed>  $document
     */
    protected function levelIds(array $document): string
    {
        return collect($document['levels'])->pluck('id')->implode(', ');
    }
}
