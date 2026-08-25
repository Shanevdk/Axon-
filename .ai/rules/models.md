---
paths:
  - app/Models/Project.php
  - app/Models/User.php
  - app/Models/OrganizationInvitation.php
---

# Models

## Work time is measured from save activity, not timers
`Project::recordWork()` accumulates `worked_seconds` from gaps between save/open events: a gap within `IDLE_THRESHOLD_SECONDS` (10 min) counts as work, a longer gap starts a new session and adds nothing. It is called from `ProjectController@show` and `@updateDocument` — the editor's autosave is the heartbeat.

Do not add a client-side timer or send elapsed time from the browser; the server clock is the only source of truth. Uses `saveQuietly` so it never touches `updated_at`.

Projects carry both `client_id` (relation) and the legacy `client` string; assignment and client renames keep the string in sync because dashboards and title blocks read it.

## Team scope comes from the organization, not ownership
Users optionally belong to an `Organization`. Everyone in one shares all projects, clients and hours.

Listing controllers must query `$user->teamProjects()` / `$user->teamClients()` (which fall back to the user's own records when they have no organization) — never `$user->projects()` for a read screen. `ProjectPolicy` and `ClientPolicy` authorize on same-organization membership, not `user_id`.

Join codes are `AX-XXXX-XXXX` from an alphabet with no 0/O/1/I because they get read aloud. `owner_id` and `join_code` are never mass assigned — `forceFill` them, so a crafted request cannot nominate an owner or pick a code. Only the head sees the code.</note>
</invoke>
<invoke name="TaskUpdate">
<parameter name="taskId">20

## Email invitations are tokened links, matched by lower-cased address
The head invites by email; `OrganizationInvitation` holds a random 48-char token and is pending for `EXPIRY_DAYS` (14) from `created_at`. Resending forceFills a new token and resets `created_at`, so the window restarts.

Addresses are always stored and compared through `normaliseEmail()` (trimmed, lower-cased) — `User::pendingInvitations()` and the "already a member" check both use `whereRaw('lower(email) = ?')`, so never compare `email` directly.

`token`, `accepted_at`, `created_at` and `invited_by` are never mass assigned. `(organization_id, email)` is unique — re-inviting uses `firstOrNew` and refreshes rather than duplicating.

Guests following a link get the invitation put in the session and are sent to register; `CreateNewUser` claims it after the account exists. Delivery failure is caught and logged, and the head can copy the link out of the pending list instead.</note>
</invoke>
