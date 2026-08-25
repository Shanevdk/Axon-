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

#[Name('place-room')]
#[Description('Tag a room at a plan point (millimetres) on a level. Put the point inside a space enclosed by walls; the editor finds the boundary and computes the area itself.')]
class PlaceRoomTool extends Tool
{
    use MutatesDocuments;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'project_id' => ['required', 'integer', 'exists:projects,id'],
            'level' => ['required', 'string'],
            'x' => ['required', 'numeric'],
            'y' => ['required', 'numeric'],
            'name' => ['required', 'string', 'max:120'],
            'number' => ['nullable', 'string', 'max:20'],
        ]);

        $project = Project::query()->findOrFail($validated['project_id']);
        $document = $this->documentFor($project);

        if (! $this->levelExists($document, $validated['level'])) {
            return Response::error(sprintf(
                'Level "%s" does not exist. Available levels: %s.',
                $validated['level'],
                $this->levelIds($document),
            ));
        }

        $id = $this->elementId('room');

        $document['elements'][] = [
            'id' => $id,
            'kind' => 'room',
            'level' => $validated['level'],
            'p' => ['x' => (float) $validated['x'], 'y' => (float) $validated['y']],
            'name' => $validated['name'],
            'number' => $validated['number'] ?? $this->nextRoomNumber($document, $validated['level']),
        ];

        $this->saveDocument($project, $document);

        return Response::structured([
            'created' => $id,
            'message' => sprintf('Room "%s" tagged on %s.', $validated['name'], $validated['level']),
        ]);
    }

    /**
     * Mirror the editor's numbering: the level index picks the hundreds block.
     *
     * @param  array<string, mixed>  $document
     */
    private function nextRoomNumber(array $document, string $level): string
    {
        $levelIndex = max((int) collect($document['levels'])->search(
            fn (array $item): bool => $item['id'] === $level,
        ), 0);
        $base = ($levelIndex + 1) * 100;

        $highest = collect($document['elements'])
            ->filter(fn (array $element): bool => $element['kind'] === 'room')
            ->map(fn (array $element): int => (int) $element['number'])
            ->filter(fn (int $number): bool => $number >= $base && $number < $base + 100)
            ->max();

        return (string) ($highest ? $highest + 1 : $base + 1);
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
            'level' => $schema->string()
                ->description('Level id the room sits on, e.g. "level-1".')
                ->required(),
            'x' => $schema->number()
                ->description('Plan x of the tag point in millimetres, inside the enclosed space.')
                ->required(),
            'y' => $schema->number()
                ->description('Plan y of the tag point in millimetres, inside the enclosed space.')
                ->required(),
            'name' => $schema->string()
                ->description('Room name, e.g. "Kitchen".')
                ->required(),
            'number' => $schema->string()
                ->description('Room number. Defaults to the next free number for the level (101, 102, … on level 1).'),
        ];
    }
}
