<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\AddLevelTool;
use App\Mcp\Tools\CreateWallsTool;
use App\Mcp\Tools\DeleteElementsTool;
use App\Mcp\Tools\DesignLibraryItemTool;
use App\Mcp\Tools\GetDesignBoardTool;
use App\Mcp\Tools\GetDocumentTool;
use App\Mcp\Tools\GetLibraryItemTool;
use App\Mcp\Tools\ListLibraryItemsTool;
use App\Mcp\Tools\ListProjectsTool;
use App\Mcp\Tools\PlaceOpeningTool;
use App\Mcp\Tools\PlaceRoomTool;
use App\Mcp\Tools\SetDesignBoardTool;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;
use Laravel\Mcp\Server\Tool;

#[Name('Axon CAD')]
#[Version('1.0.0')]
#[Instructions(<<<'MARKDOWN'
    This server edits Axon model documents, the way the
    Revit MCP bridge edits a Revit model.

    Ground rules:
    - Every length is in millimetres, no matter what units the project
      displays. Never send feet, inches or metres.
    - Plan coordinates are x east and y north, with walls drawn between two
      points on a named level.
    - Start with `list-projects`, then `get-document` to learn the level ids,
      wall type ids and existing elements before modifying anything.
    - The drawing editor autosaves; if it is open on the same project your
      changes appear after the browser reloads the page.
    - When asked to work the design board, use get-design-board and
      set-design-board. That is the item designer open in somebody's browser:
      they watch your changes appear live and can edit any number by hand.
      This is how a Claude subscription drives Axon without API credit.
    - The model library is the studio's shelf of reusable items. Design
      couches, tables — anything — with design-library-item from box,
      cylinder and sketched-outline parts; people place them from the
      editor's Insert tab and can reopen them in the item designer.
    MARKDOWN)]
class CadServer extends Server
{
    /**
     * The tools registered with this MCP server.
     *
     * @var array<int, class-string<Tool>>
     */
    protected array $tools = [
        ListProjectsTool::class,
        GetDocumentTool::class,
        CreateWallsTool::class,
        PlaceOpeningTool::class,
        PlaceRoomTool::class,
        AddLevelTool::class,
        DeleteElementsTool::class,
        ListLibraryItemsTool::class,
        GetLibraryItemTool::class,
        DesignLibraryItemTool::class,
        GetDesignBoardTool::class,
        SetDesignBoardTool::class,
    ];
}
