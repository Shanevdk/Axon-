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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[Name('delete-elements')]
#[Description('Delete elements from a project by id. Doors and windows hosted by a deleted wall are removed with it, matching the editor. Nothing is deleted when any id is unknown.')]
#[IsDestructive]
class DeleteElementsTool extends Tool
{
    use MutatesDocuments;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer', 'exists:projects,id'],
            'element_ids' => ['required', 'array', 'min:1', 'max:500'],
            'element_ids.*' => ['string'],
        ]);

        $project = Project::query()->findOrFail($validated['project_id']);
        $document = $this->documentFor($project);

        $removed = collect($validated['element_ids'])->flip();
        $known = collect($document['elements'])->pluck('id')->flip();

        $missing = $removed->keys()->reject(
            fn (string $id): bool => $known->has($id),
        );

        if ($missing->isNotEmpty()) {
            return Response::error(sprintf(
                'No element(s) with id: %s. Use get-document for the current ids — nothing was deleted.',
                $missing->implode(', '),
            ));
        }

        // Openings ride with their host wall, exactly as the editor deletes.
        foreach ($document['elements'] as $element) {
            if (
                in_array($element['kind'], ['door', 'window'], true)
                && $removed->has($element['host'] ?? '')
            ) {
                $removed->put($element['id'], true);
            }
        }

        $before = count($document['elements']);
        $document['elements'] = collect($document['elements'])
            ->reject(fn (array $element): bool => $removed->has($element['id']))
            ->values()
            ->all();

        $this->saveDocument($project, $document);

        $deleted = $before - count($document['elements']);

        return Response::structured([
            'deleted' => $deleted,
            'message' => sprintf('%d element(s) deleted.', $deleted),
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
            'element_ids' => $schema->array()
                ->description('Element ids to delete, from get-document.')
                ->required(),
        ];
    }
}
