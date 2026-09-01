<?php

namespace App\Mcp\Tools;

use App\Actions\Library\CompileItemParts;
use App\Mcp\Tools\Concerns\ScopesToTheAsker;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;

#[Name('set-design-board')]
#[Description(<<<'TEXT'
    Put a revised parts board in front of the person using Vanhaven's item
    designer. What you send replaces the whole board and appears in their
    preview within a couple of seconds — say what you changed in `note` and
    it prints in their terminal.

    Parts are millimetres: box and cylinder sized width × depth × height, or
    sketch with a closed outline of plan points extruded to its height. x and
    y place a part's centre from the item centre; z is the underside height;
    rotation is degrees about vertical. Read the board first with
    get-design-board so you revise what is actually there.
    TEXT)]
class SetDesignBoardTool extends Tool
{
    use ScopesToTheAsker;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:2000'],
            'name' => ['nullable', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:60'],
            ...CompileItemParts::partRules(),
        ], [
            'parts.required' => 'Send the whole board as parts: [{"shape":"box","width":1800,"depth":900,"height":420}, …] in millimetres.',
            'parts.*.points.required_if' => 'A sketch part needs points: a closed plan outline of at least three corners.',
        ]);

        $board = $this->visibleDesignBoards()->latest('opened_at')->first();

        if ($board === null) {
            return Response::error(
                'No design board is open. Ask the person to open the item designer in Vanhaven and run `claude` in its terminal.'
            );
        }

        $parts = CompileItemParts::normaliseParts($validated['parts']);
        $mesh = (new CompileItemParts)->handle($parts);

        if ($mesh['triangleCount'] === 0) {
            return Response::error(
                'Those parts compile to nothing — check that sketch outlines have three or more distinct corners.'
            );
        }

        $board->publish($parts, 'claude', array_filter([
            'note' => $validated['note'] ?? null,
            'name' => $validated['name'] ?? $board->name,
            'category' => $validated['category'] ?? $board->category,
        ], fn ($value): bool => $value !== null));

        return Response::structured([
            'revision' => $board->revision,
            'part_count' => count($parts),
            'size_mm' => $mesh['size'],
            'someone_is_watching' => $board->isBeingWatched(),
            'note' => $board->isBeingWatched()
                ? 'On their screen now. They can edit any number by hand, and you will see it next time you read the board.'
                : 'Saved, but nobody has the designer open — they will see it when they return.',
        ]);
    }
}
