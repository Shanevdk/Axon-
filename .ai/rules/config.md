---
paths:
  - config/database.php
---

# Config

## Migrate over pgsql_direct, not the pooled connection
`pgsql` is the pooled cluster connection the app runs on. Setting `DB_READ_HOST` turns it into a sticky read/write split; leaving it unset keeps the plain single-host shape, so both forms must stay working.

`pgsql_direct` is the same cluster without the pooler, and deploys must use it for schema changes — `php artisan migrate --force --database=pgsql_direct`. A transaction pooler recycles connections mid-statement, which breaks the advisory lock migrations take. With `DB_DIRECT_URL` unset it falls back to the pooled settings, which is right for a single unpooled server.

`composer test:pgsql` runs the whole suite against real Postgres with the split enabled (both endpoints pointing at one local server), so the clustered config shape is the one under test. Run it before deploying a schema change.
