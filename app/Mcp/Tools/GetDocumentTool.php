<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\MutatesDocuments;
use App\Models\Project;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get-document')]
#[Description('Fetch a project\'s full model document: levels, wall/door/window type catalogues and every element. All lengths are millimetres. Read this before editing so you use real level ids, type ids and element ids.')]
#[IsReadOnly]
#[IsIdempotent]
class GetDocumentTool extends Tool
{
    use MutatesDocuments;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer', 'exists:projects,id'],
        ], [
            'project_id.exists' => 'No project has that id. Call list-projects to see the available ids.',
        ]);

        $project = Project::query()->findOrFail($validated['project_id']);

        return Response::structured([
            'project' => ['id' => $project->id, 'name' => $project->name],
            // Honest about which it is: once a drawing lives on a machine the
            // server holds one level of it and nothing more.
            'is_preview' => $project->has_local_model,
            'note' => $project->has_local_model
                ? 'This is a preview of one level. The full model is on the computer that drew it.'
                : 'This is the whole model.',
            'document' => $this->documentFor($project),
        ]);
    }

    /**
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, from list-projects.')
                ->required(),
        ];
    }
}
