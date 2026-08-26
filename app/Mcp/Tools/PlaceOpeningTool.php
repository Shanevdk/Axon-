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

#[Name('place-opening')]
#[Description('Place a door or window in an existing wall, positioned by its distance in millimetres from the wall\'s start point (the wall\'s "a" end). The opening is clamped so it never runs past the wall.')]
class PlaceOpeningTool extends Tool
{
    use MutatesDocuments;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer', 'exists:projects,id'],
            'kind' => ['required', 'in:door,window'],
            'host' => ['required', 'string'],
            'at' => ['required', 'numeric', 'min:0'],
            'type_id' => ['nullable', 'string'],
        ], [
            'kind.in' => 'kind must be "door" or "window".',
            'at.min' => 'at is the distance in millimetres from the wall\'s start point and cannot be negative.',
        ]);

        $project = Project::query()->findOrFail($validated['project_id']);

        if ($away = $this->refuseIfAway($project)) {
            return $away;
        }

        $document = $this->documentFor($project);

        $host = collect($document['elements'])->first(
            fn (array $element): bool => $element['id'] === $validated['host']
                && $element['kind'] === 'wall',
        );

        if ($host === null) {
            return Response::error(sprintf(
                'No wall with id "%s" exists. Use get-document (or the ids returned by create-walls) to find a host wall.',
                $validated['host'],
            ));
        }

        $length = hypot(
            $host['b']['x'] - $host['a']['x'],
            $host['b']['y'] - $host['a']['y'],
        );

        $catalogue = $validated['kind'] === 'door' ? 'doorTypes' : 'windowTypes';
        $types = collect($document[$catalogue]);
        $typeId = $validated['type_id'] ?? $types->first()['id'];
        $type = $types->first(fn (array $item): bool => $item['id'] === $typeId);

        if ($type === null) {
            return Response::error(sprintf(
                '%s type "%s" does not exist. Available types: %s.',
                ucfirst($validated['kind']),
                $typeId,
                $types->pluck('id')->implode(', '),
            ));
        }

        if ($length <= $type['width']) {
            return Response::error(sprintf(
                'The host wall is %.0f mm long but the %s is %.0f mm wide — pick a longer wall or a narrower type.',
                $length,
                $validated['kind'],
                $type['width'],
            ));
        }

        // Clamp so the leaf stays inside the wall, as the editor does.
        $margin = $type['width'] / 2 / $length;
        $t = min(max($validated['at'] / $length, $margin), 1 - $margin);

        $id = $this->elementId($validated['kind']);

        $document['elements'][] = [
            'id' => $id,
            'kind' => $validated['kind'],
            'level' => $host['level'],
            'typeId' => $typeId,
            'host' => $host['id'],
            't' => $t,
            'flipFace' => false,
            'flipHand' => false,
        ];

        $this->saveDocument($project, $document);

        return Response::structured([
            'created' => $id,
            'message' => sprintf(
                '%s placed %.0f mm along wall %s.',
                ucfirst($validated['kind']),
                $t * $length,
                $host['id'],
            ),
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
            'kind' => $schema->string()
                ->enum(['door', 'window'])
                ->description('Whether to place a door or a window.')
                ->required(),
            'host' => $schema->string()
                ->description('Element id of the wall that hosts the opening.')
                ->required(),
            'at' => $schema->number()
                ->description('Distance in millimetres from the wall\'s start ("a") point to the opening centre.')
                ->required(),
            'type_id' => $schema->string()
                ->description('Type id from the document\'s doorTypes or windowTypes catalogue. Defaults to the first type.'),
        ];
    }
}
