---
paths:
  - config/database.php
  - config/fortify.php
---

# Config

## Migrate over pgsql_direct, not the pooled connection
`pgsql` is the pooled cluster connection the app runs on. Setting `DB_READ_HOST` turns it into a sticky read/write split; leaving it unset keeps the plain single-host shape, so both forms must stay working.

`pgsql_direct` is the same cluster without the pooler, and deploys must use it for schema changes — `php artisan migrate --force --database=pgsql_direct`. A transaction pooler recycles connections mid-statement, which breaks the advisory lock migrations take. With `DB_DIRECT_URL` unset it falls back to the pooled settings, which is right for a single unpooled server.

`composer test:pgsql` runs the whole suite against real Postgres with the split enabled (both endpoints pointing at one local server), so the clustered config shape is the one under test. Run it before deploying a schema change.

## Mongo is a sidecar document store, models opt in
The `mongodb` connection (mongodb/laravel-mongodb, needs ext-mongodb) sits beside the relational core — never make it the default. A model reaches it with `protected $connection = 'mongodb';` extending `MongoDB\Laravel\Eloquent\Model`; everything else stays on the default connection. Configuration is one URI (`MONGODB_URI`) so local (`mongodb://127.0.0.1:27017`) and Atlas are a one-variable swap. `tests/Feature/MongoDatabaseTest.php` proves the wiring without a server; its live ping self-skips when nothing is listening.

## APP_URL is load-bearing — changing it invalidates every passkey
`relying_party_id` and `allowed_origins` are derived from `config('app.url')`. A passkey is cryptographically bound to the host it was registered on, so changing APP_URL (moving to a custom domain, adding/removing `www`) silently breaks every existing passkey — holders must delete and re-register. Invitation links come from `route()` and are built off the same value, so a wrong APP_URL sends invites to a host nobody can reach. Set APP_URL to the final public domain before people start enrolling passkeys.
