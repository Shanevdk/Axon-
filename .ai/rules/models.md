---
paths:
  - app/Models/Project.php
  - app/Models/User.php
  - app/Models/OrganizationInvitation.php
  - app/Models/Meeting.php
  - app/Models/DesignBoard.php
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

## Meetings hold studio wall-clock time, never a timezone
`meetings.starts_at` / `ends_at` store exactly what was typed: 15:00 in, 15:00 out. `config('app.timezone')` is UTC but nothing here is converted through it, because a meeting belongs to the studio's clock, not the browser's.

The form posts `date` + `start_time` + `end_time` and `BooksAMeeting::booking()` stitches them with `Carbon::createFromFormat('Y-m-d H:i', ...)`. MeetingController sends them back split (`date`, `start_time`, `end_time`) — never `toIso8601String()`, which the browser would shift. `Meeting::scopeBetweenDays()` compares against plain `Y-m-d` bounds for the same reason.

On the client, `resources/js/pages/calendar/index.tsx` formats times by splitting the string and builds dates via `new Date(y, m-1, d)`. Passing a `YYYY-MM-DD` string to `new Date()` parses it as UTC and can land on the day before.

## Presence is derived, and never name a method after a column
Presence on the chat page is resolved by `User::currentPresence()`: absence (no heartbeat inside ACTIVE_WINDOW_MINUTES) beats everything, then the pinned `presence` column, then a diary meeting happening now (`currentMeeting()`, wall-clock comparison — never timezone-convert), else available. `meeting` is never storable — it only ever comes from the calendar. The heartbeat is the `RecordPresence` web middleware; writes are throttled to once a minute and saved quietly.

Trap: the method was first called `presence()`, colliding with the `presence` column — on a model whose attribute isn't loaded (fresh `create()`), `$user->presence` resolves the METHOD as a relationship and 500s. Never give a method the same name as a column.

## The design board bridges Claude Code to the designer — subscription, not API
`design_boards` is one live parts board per user, written from both sides: the browser publishes what is on screen, Claude Code reads and revises it over MCP (`get-design-board` / `set-design-board`). This is the only way a Claude subscription drives Vanhaven — a Max/Pro plan cannot sign API calls, but Claude Code already runs on it, so the work happens there and nothing bills an API account.

`revision` + `source` are the anti-echo: each side ignores revisions it caused. In the terminal that means an adopted board sets `adopting.current` so the publish effect skips one beat — remove that and the browser and Claude Code loop forever.

MCP writes go through `CompileItemParts::partRules()` + `normaliseParts()` like every other author of parts, so a bad board is refused at the door and the browser's copy is untouched. `get-design-board` clears `message` as it reads (a note is delivered once) and stamps `claimed_at`, which is what flips the terminal from "waiting" to connected. `opened_at` inside `AT_THE_BOARD_MINUTES` is how the tools tell Claude Code whether anyone is actually watching.
