<?php

namespace App\Mcp\Tools\Concerns;

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
 */
trait MutatesDocuments
{
    /**
     * Refuse to touch a project whose model lives on someone's machine.
     *
     * Once a drawing is local the server keeps only a one-level preview, and
     * the editor overwrites that preview on its next save. Editing it here
     * would look like it worked and then quietly vanish, so it is stopped.
     */
    protected function refuseIfAway(Project $project): ?Response
    {
        if (! $project->has_local_model) {
            return null;
        }

        return Response::error(sprintf(
            'The model for "%s" is held on the computer that drew it — the server keeps only a preview, '
            .'so it cannot be edited from here. Open the project in Axon on that machine, or use '
            .'Download drawing to move it.',
            $project->name,
        ));
    }

    /**
     * @return array<string, mixed>
     */
    protected function documentFor(Project $project): array
    {
        return app(BuildStarterDocument::class)->normalize($project->document);
    }

    /**
     * @param  array<string, mixed>  $document
     */
    protected function saveDocument(Project $project, array $document): void
    {
        $project->update(['document' => $document]);
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
