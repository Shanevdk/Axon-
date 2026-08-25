---
paths:
  - 'resources/js/pages/**'
---

# Pages

## Never pass a conditional interval to usePoll
`usePoll(condition ? 5000 : 0, …)` is a server-flooding trap. Inertia's Poll has no zero guard — it calls `setInterval(tick, 0)`, firing a partial reload every few milliseconds. Worse, the hook's `useEffect` has an empty dependency array, so the interval is read once at mount and never updated when the condition changes.

Put the poll inside a component that is only rendered when polling is wanted, with a literal interval — see `TeamChat` in `pages/organization/index.tsx`. If you must keep it at the top level, pass `{ autoStart: false }` and drive it with the returned `start()` / `stop()`.</note>
</invoke>
