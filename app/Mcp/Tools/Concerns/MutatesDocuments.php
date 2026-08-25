<?php

namespace App\Mcp\Tools\Concerns;

use App\Actions\Projects\BuildStarterDocument;
use App\Models\Project;
use Illuminate\Support\Str;

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
