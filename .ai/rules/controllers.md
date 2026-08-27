---
paths:
  - app/Http/Controllers/NoteController.php
---

# Controllers

## The notebook and diary are shared, and pinning is a server-side toggle
Notes and meetings follow the same team scope as projects and clients: read through `teamNotes()` / `teamMeetings()`, and `NotePolicy` / `MeetingPolicy` authorize on same-organization membership rather than `user_id`. Each row carries `author` so the studio can see who wrote it.

`pinned` is never taken from the request body in practice — `notes.pin` (PATCH) flips it server side. That means an edit through `notes.update` leaves the pin alone, which is what the dialog relies on: it has no pin control.

Meetings may only point at a client or drawing the same team can see; both requests build their `Rule::exists(...)->whereIn('user_id', $this->user()->teamMemberIds())` for that.
