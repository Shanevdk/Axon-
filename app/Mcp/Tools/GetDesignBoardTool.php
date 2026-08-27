<?php

namespace App\Mcp\Tools;

use App\Models\DesignBoard;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get-design-board')]
#[Description(<<<'TEXT'
    Read the parts board somebody has open in Axon's item designer right now,
    along with anything they have typed to you from the browser terminal.

    Call this first when asked to work the design board, and again whenever
    you want to see hand edits made in the browser. Write back with
    set-design-board — the person watching sees the change immediately.
    TEXT)]
#[IsReadOnly]
#[IsIdempotent]
class GetDesignBoardTool extends Tool
{
    public function handle(Request $request): Response|ResponseFactory
    {
        $board = DesignBoard::query()->latest('opened_at')->first();

        if ($board === null) {
            return Response::error(
                'No design board is open. Ask the person to open the item designer in Axon (Library → Design an item) and run `claude` in its terminal.'
            );
        }

        // Reading counts as picking up the work: the browser stops saying it
        // is waiting the moment this happens.
        $waiting = $board->message;

        $board->forceFill([
            'claimed_at' => now(),
            'message' => null,
        ])->save();

        return Response::structured([
            'revision' => $board->revision,
            'name' => $board->name,
            'category' => $board->category,
            'parts' => $board->parts,
            'part_count' => count($board->parts),
            'they_said' => $waiting,
            'someone_is_watching' => $board->isBeingWatched(),
            'note' => 'Parts are millimetres: box, cylinder or sketch, sized width × depth × height, at x/y from the item centre and z as the underside height. Reply with set-design-board to change what they see.',
        ]);
    }
}
