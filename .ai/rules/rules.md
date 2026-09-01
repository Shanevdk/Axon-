---
paths:
  - app/Rules/WorkEmail.php
---

# Rules

## Work email only: a rule at the doors, middleware at the sessions
Vanhaven accounts belong to a practice. `WorkEmail` is a BLOCKLIST of consumer providers (`config/workmail.php`), never an allowlist of firms — no list of company domains could keep up. Sub-domains of a blocked domain are blocked too; a domain merely *containing* one (`notgmail.com`) is a real firm and passes.

Two layers, both needed: the rule guards anything that SETS an address (`ProfileValidationRules::emailRules()` covers registration and profile change; the invitation controller adds it), and `EnsureWorkEmail` middleware guards anything that OPENS a session. The middleware exists because there are several login paths — password, passkey, two-factor, remembered cookie — and checking the signed-in user means none can be forgotten; it also strands accounts made before the rule existed. It logs out and invalidates rather than merely redirecting.

`WorkEmail::passes()` returns true for non-addresses on purpose, so the `email` rule reports those instead. `config('workmail.allowed')` is the escape hatch for a founder's personal account — use it rather than editing the blocklist.
