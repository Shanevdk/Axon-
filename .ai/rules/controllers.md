---
paths:
  - app/Http/Controllers/NoteController.php
  - app/Http/Controllers/OrganizationInvitationController.php
  - app/Http/Controllers/ClientPortalController.php
---

# Controllers

## The notebook and diary are shared, and pinning is a server-side toggle
Notes and meetings follow the same team scope as projects and clients: read through `teamNotes()` / `teamMeetings()`, and `NotePolicy` / `MeetingPolicy` authorize on same-organization membership rather than `user_id`. Each row carries `author` so the studio can see who wrote it.

`pinned` is never taken from the request body in practice — `notes.pin` (PATCH) flips it server side. That means an edit through `notes.update` leaves the pin alone, which is what the dialog relies on: it has no pin control.

Meetings may only point at a client or drawing the same team can see; both requests build their `Rule::exists(...)->whereIn('user_id', $this->user()->teamMemberIds())` for that.

## No public sign-up: the invitation link is the only way an account is made
`Features::registration()` is deliberately absent from config/fortify.php, so `register` and `register.store` do not exist — there is a test asserting that. `CreateNewUser` and the register page were deleted with it; do not reinstate either.

Accounts are made in exactly one place: `OrganizationInvitationController::open()`, reached from the emailed link via `accept()` → session → `setUp()` (page `auth/set-up`). The address comes from the invitation in the session, NEVER from the form — `CreateInvitedUserRequest` asks only for name and password, which is what stops a crafted post turning one person's link into another person's account. The account is marked verified on creation because being invited by name is the proof.

The first account has no door, so it is made with `php artisan axon:admin`, which also creates the studio and puts that user at its head. Everyone after that is invited from the Organization page.

New Inertia page components need `npm run build` before Pest will render them — a missing manifest entry surfaces as "Not a valid Inertia response", not as a manifest error.

## The client portal is a session, not an account
Clients have no User row and no auth guard. `Client` is issued a `portal_username` (slug of the name, uniqued) and a 12-digit `portal_number` by the `creating` hook in the model, so every client gets them whoever adds them — register, seeder or factory.

The number IS the whole credential: `portal.open` exchanges it for `portal_client_id` in the session, regenerating the session id first. `EnsureClientSignedIn` (alias `portal`) re-reads the client from the database on every request, so a removed client's cookie stops working at once. `portal.open` carries `throttle:5,1` — the number is the only secret, so do not take that off.

Everything past the door is read-only bar `portal.comments.store`. Never add a route here that writes a drawing. The comment's `client_id` and `project_id` are forceFilled from the session, never from the request, and `project_id` is validated with `Rule::exists('projects','id')->where('client_id', $client->id)` so a crafted id cannot reach another client's house. Both guards have tests that fail without them.

`portal_username`, `portal_number` and `portal_seen_at` are outside `#[Fillable]`. Portal pages return `null` from the layout switch in app.tsx — the studio chrome expects a signed-in user.
