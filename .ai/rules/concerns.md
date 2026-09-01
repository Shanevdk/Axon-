---
paths:
  - app/Concerns/AllowsTimeToAnswer.php
---

# Concerns

## An HTTP timeout longer than max_execution_time can never fire
PHP gives a web request 30 seconds (Herd's php.ini, and most hosts). Every borrowed service here is configured to wait longer — OpenRouter 60, Pollinations 120, Claude Code 180 — so without help PHP kills the process mid-call with a FATAL error. The `->timeout()` never fires, the `catch (RuntimeException)` never runs, and the user gets a dead request instead of "the model is busy, try again".

Any action waiting on a slow service must use `AllowsTimeToAnswer` and wrap its timeout: `->timeout($this->allowSecondsToAnswer((int) config('services.x.timeout')))`. That raises the request budget above the wait so the configured timeout is what actually happens.

`SlowServicesTest` walks every `services.*.timeout` and asserts each one fits inside a request; adding a new slow service means adding it to that dataset.

Symptom to recognise: `local.ERROR: Maximum execution time of 30 seconds exceeded` with a Guzzle `CurlFactory` frame in the trace. The default code-consultant model is a reasoning model and takes ~30s for a real question, which is what first exposed this.
