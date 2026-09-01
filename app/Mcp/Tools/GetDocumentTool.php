<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\MutatesDocuments;
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
            'project_id' => ['required', 'integer'],
        ]);

        $project = $this->visibleProjects()->find($validated['project_id']);

        if ($project === null) {
            return $this->refuseUnknownProject();
        }

        // Lent by the editor's sidebar for this turn, so it is the live
        // drawing — newer than anything the server has stored.
        $lent = $this->bench()->isOpen($project->id);
        $preview = $project->has_local_model && ! $lent;

        return Response::structured([
            'project' => ['id' => $project->id, 'name' => $project->name],
            // Honest about which it is: once a drawing lives on a machine the
            // server holds one level of it and nothing more.
            'is_preview' => $preview,
            'note' => match (true) {
                $lent => 'This is the live drawing, lent by the editor for this turn. Edits made here go back to it.',
                $preview => 'This is a preview of one level. The full model is on the computer that drew it.',
                default => 'This is the whole model.',
            },
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
