<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\ScopesToTheAsker;
use App\Models\Project;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list-projects')]
#[Description('List every CAD project with its id, units and a model summary. Call this first to find the project to work on.')]
#[IsReadOnly]
#[IsIdempotent]
class ListProjectsTool extends Tool
{
    use ScopesToTheAsker;

    public function handle(Request $request): Response|ResponseFactory
    {
        // The asker's studio and nobody else's. Unscoped, this tool hands a
        // connector every drawing in the database on its first call.
        $projects = $this->visibleProjects()
            ->latest('updated_at')
            ->get()
            ->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
                'units' => $project->units,
                'updated_at' => $project->updated_at?->toIso8601String(),
                'summary' => $project->documentSummary(),
            ]);

        return Response::structured(['projects' => $projects->all()]);
    }
}
