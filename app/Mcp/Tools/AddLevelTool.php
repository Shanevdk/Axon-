<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\MutatesDocuments;
use App\Models\Project;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;

#[Name('add-level')]
#[Description('Add a storey to a project. Elevation is in millimetres above ground; omit it to stack 3000 mm above the highest existing level.')]
class AddLevelTool extends Tool
{
    use MutatesDocuments;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer', 'exists:projects,id'],
            'name' => ['required', 'string', 'max:120'],
            'elevation' => ['nullable', 'numeric'],
        ]);

        $project = Project::query()->findOrFail($validated['project_id']);

        if ($away = $this->refuseIfAway($project)) {
            return $away;
        }

        $document = $this->documentFor($project);

        $elevation = $validated['elevation']
            ?? collect($document['levels'])->max('elevation') + 3000;

        $id = sprintf('level-%s', Str::lower(Str::random(8)));

        $document['levels'][] = [
            'id' => $id,
            'name' => $validated['name'],
            'elevation' => (float) $elevation,
        ];

        $this->saveDocument($project, $document);

        return Response::structured([
            'created' => $id,
            'message' => sprintf(
                'Level "%s" added at %.0f mm.',
                $validated['name'],
                $elevation,
            ),
        ]);
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->integer()
                ->description('Id of the project, from list-projects.')
                ->required(),
            'name' => $schema->string()
                ->description('Name of the new level, e.g. "Level 3".')
                ->required(),
            'elevation' => $schema->number()
                ->description('Elevation in millimetres. Defaults to 3000 above the highest level.'),
        ];
    }
}
