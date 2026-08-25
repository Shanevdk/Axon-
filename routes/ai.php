<?php

use App\Mcp\Servers\CadServer;
use Laravel\Mcp\Facades\Mcp;

/*
|--------------------------------------------------------------------------
| MCP Servers
|--------------------------------------------------------------------------
|
| The CAD server lets AI clients read and edit model documents the way the
| Revit MCP bridge edits a Revit model. It runs locally over stdio; start
| it from an MCP client with `php artisan mcp:start cad` (see .mcp.json).
|
*/

Mcp::local('cad', CadServer::class);
