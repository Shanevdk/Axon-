<?php

use App\Mcp\Servers\CadServer;
use Laravel\Mcp\Facades\Mcp;

/*
|--------------------------------------------------------------------------
| MCP Servers
|--------------------------------------------------------------------------
|
| The CAD server lets AI clients read and edit model documents the way the
| Revit MCP bridge edits a Revit model. It is reached two ways.
|
| Over stdio, started by an MCP client with `php artisan mcp:start cad` (see
| .mcp.json) — that is the editor sidebar and anyone working locally.
|
| Over HTTP, as a connector: somebody adds Vanhaven to Claude, signs in here,
| and drives their drawings from the Claude app itself. That route carries an
| OAuth token rather than a session, so it sits behind Passport's `auth:api`
| guard, and `oauthRoutes()` publishes the discovery documents and the
| dynamic client registration endpoint Claude needs to find its way in.
|
| Both reach the same tools, and the tools scope everything to whoever is
| asking — see ScopesToTheAsker. Do not add a tool that queries a model
| directly; over HTTP that hands one studio another studio's building.
|
*/

Mcp::local('cad', CadServer::class);

Mcp::oauthRoutes();

Mcp::web('mcp/cad', CadServer::class)->middleware('auth:api');
