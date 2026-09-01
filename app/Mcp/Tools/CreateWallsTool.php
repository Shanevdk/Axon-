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

#[Name('create-walls')]
#[Description('Add one or more walls to a level. Each wall runs between two plan points in millimetres. Returns the new element ids, which door and window placement need as hosts.')]
class CreateWallsTool extends Tool
{
    use MutatesDocuments;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer'],
            'level' => ['required', 'string'],
            'type_id' => ['nullable', 'string'],
            'height' => ['nullable', 'numeric', 'min:100', 'max:20000'],
            'walls' => ['required', 'array', 'min:1', 'max:100'],
            'walls.*.a.x' => ['required', 'numeric'],
            'walls.*.a.y' => ['required', 'numeric'],
            'walls.*.b.x' => ['required', 'numeric'],
            'walls.*.b.y' => ['required', 'numeric'],
        ], [
            'walls.required' => 'Provide walls as [{"a":{"x":0,"y":0},"b":{"x":6000,"y":0}}, …] in millimetres.',
            'height.max' => 'Wall height is in millimetres; 20000 (20 m) is the ceiling.',
        ]);

        $project = $this->visibleProjects()->find($validated['project_id']);

        if ($project === null) {
            return $this->refuseUnknownProject();
        }

        if ($away = $this->refuseIfAway($project)) {
            return $away;
        }

        $document = $this->documentFor($project);

        if (! $this->levelExists($document, $validated['level'])) {
            return Response::error(sprintf(
                'Level "%s" does not exist. Available levels: %s.',
                $validated['level'],
                $this->levelIds($document),
            ));
        }

        $types = collect($document['wallTypes']);
        $typeId = $validated['type_id'] ?? $types->first()['id'];

        if (! $types->contains(fn (array $type): bool => $type['id'] === $typeId)) {
            return Response::error(sprintf(
                'Wall type "%s" does not exist. Available types: %s.',
                $typeId,
                $types->pluck('id')->implode(', '),
            ));
        }

        $ids = [];

        foreach ($validated['walls'] as $wall) {
            $length = hypot(
                $wall['b']['x'] - $wall['a']['x'],
                $wall['b']['y'] - $wall['a']['y'],
            );

            if ($length < 10) {
                return Response::error('Each wall must be at least 10 mm long — check that a and b are different points in millimetres.');
            }

            $id = $this->elementId('wall');
            $ids[] = $id;

            $document['elements'][] = [
                'id' => $id,
                'kind' => 'wall',
                'level' => $validated['level'],
                'typeId' => $typeId,
                'a' => ['x' => (float) $wall['a']['x'], 'y' => (float) $wall['a']['y']],
                'b' => ['x' => (float) $wall['b']['x'], 'y' => (float) $wall['b']['y']],
                'height' => (float) ($validated['height'] ?? 3000),
                'baseOffset' => 0,
                'locationLine' => 'center',
            ];
        }

        $this->saveDocument($project, $document);

        return Response::structured([
            'created' => $ids,
            'message' => sprintf('%d wall(s) added on %s.', count($ids), $validated['level']),
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
            'level' => $schema->string()
                ->description('Level id the walls belong to, e.g. "level-1". Get real ids from get-document.')
                ->required(),
            'type_id' => $schema->string()
                ->description('Wall type id from the document\'s wallTypes catalogue. Defaults to the first type.'),
            'height' => $schema->number()
                ->description('Wall height in millimetres. Defaults to 3000.'),
            'walls' => $schema->array()
                ->description('Wall segments, each {"a":{"x":…,"y":…},"b":{"x":…,"y":…}} in millimetres. For a closed room supply four touching segments sharing endpoints.')
                ->required(),
        ];
    }
}
