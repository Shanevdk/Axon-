---
paths:
  - routes/ai.php
---

# Routes

## The connector: Passport is load-bearing, and APP_URL is part of the protocol
`Mcp::oauthRoutes()` + `Mcp::web('mcp/cad', ...)->middleware('auth:api')` is the whole connector. It needs the `api` guard on the `passport` driver (`token`/`sanctum` there fails SILENTLY), `HasApiTokens` + the `OAuthenticatable` interface on User, and `passport:keys` run on the host.

Claude arrives by dynamic client registration at `/oauth/register` — nobody types a client id. The consent screen is `resources/views/mcp/authorize.blade.php`, wired up with `Passport::authorizationView()` in AppServiceProvider; it is plain Blade on purpose, since the client opens it in a throwaway popup.

APP_URL is protocol, not cosmetics: the `resource` field in `/.well-known/oauth-protected-resource/mcp/cad` must equal the URL entered in Claude exactly, and it is built from APP_URL. Claude also reaches the server from the public internet, so a `.test` host needs a tunnel.

Debugging note: an unauthenticated POST without `Accept: application/json` redirects to the login page (Laravel's default) instead of 401. Real clients always send Accept; test with it or you will chase a phantom.
