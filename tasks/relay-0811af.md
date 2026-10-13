---
id: relay-0811af
title: "Minor follow-ups from the review-fixes branch review: upgrade notes, Codex probe hint, coded installer errors, remaining test timing, doc nits"
status: todo
priority: 3
size: s
complexity: mid
process: direct
created: 2026-10-13T20:04:24Z
updated: 2026-10-13T20:14:32Z
depends: []
tags: [testing]
source: "review:fix/typed-messages-review round 1"
agent: claude-code/claude-opus-5-5
---

Why: the whole-branch review of the typed-messages review fixes (relay-fb5d24, relay-cb8a44, relay-22e22b, relay-a6ef67; 2026-10-13) reported these Minor findings. They were deferred under the rule that Minor findings never enter a corrective round.

1. Moved to relay-8301b5 (a reattaching hook sees an undeliverable entry as unexpected and passes it through).
2. **The upgrade effect on persisted state is undocumented.**
   - Stored entries with uppercase UUID text now fail `validateEntry` and are quarantined at startup. A pending replacement whose predecessor is quarantined follows it.
   - A stored question with `expiresAt` beyond createdAt + 23 h loads, but an identical resend now gets ID_CONFLICT because the clamped resend differs.
   - An older relay quarantines entries that carry the new answered→undeliverable `expiry` row.

   Add one sentence to the docs/runbooks/inbox-service.md recovery section. No v1 producer writes such entries.
3. **The guard-probe hint misleads Codex installs.** The missing-probe hint in src/install/capabilities.js names Claude route rows and the inbox runbook. Append it only for harness `claude-code`.
4. **Plain installs now hit opaque errors.** Plain Claude installs now run `planRouteHooks`, so a malformed `hooks.PostToolUse` or a duplicate relay ask writer refuses. These are plain `Error`s, so `bin/relay.js` prints only "relay operation failed". Give these errors, and planHooks's own, a code so the detail reaches the user.
5. **Timing-dependent tests remain.**
   - test/cli-desk.test.js polls 20 × 10 ms for `undeliverable` after SIGKILL. Use `until` from test/helpers/wait.js.
   - test/routes-ask.test.js has a 50 ms negative check. Use `nextCall` + `settledYet`.
6. **Two test helpers are fragile.**
   - test/serve-socket.test.js `closable` asserts only `ok`, so a passthrough reply under presence `here` hangs `close()` until timeout. Assert `entry.state === 'pending'`.
   - test/helpers/wait.js `nextCall` restores the method on match, so overlapping spies on one method would drop the outer one. Document it or chain the spies.
7. **Doc nits.**
   - docs/api.md and the runbook say `/` is never opened, but as root it is synced.
   - docs/api.md lists `passthrough:true` while here alongside `UNSUPPORTED_ROUTE`, without saying the refusal wins.
   - Spec §5.3: "The answer stays saved … takes it when it reconnects" is now bounded by `expiresAt`.
   - The Appendix A `uuid` def lacks the schema's new description.

Done:
- Each item is fixed or explicitly ruled out with a note.
- Tests cover items 3 and 4.
- `just test-fast` passes on Node 22 and the dev runtime.

## Notes

- 2026-10-13T20:08:10Z (fix/typed-messages-review): added from round 2 re-review: 8) docs/api.md /v1/inbox since row: say canonical decimal (no sign or leading zeros) within the safe-integer range; 9) test/serve-http.test.js invalid-cursor test: order /v1/inbox cases first (or resolve call() on SSE headers) so a regression names its input instead of timing out; drop the duplicate ' ' header case
