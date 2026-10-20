---
id: relay-dab29a
title: Record observer failures under OpenCode in the plugin log without logging payloads
status: todo
priority: 2
size: s
complexity: mid
process: planned
created: 2026-10-19T09:56:33Z
updated: 2026-10-20T02:08:17Z
depends: []
tags: [feedback, gap, "from:fam"]
agent: claude-code/claude-opus-5-5
---

Why: `relay hook` reports an observer failure only as stderr diagnostics (src/dispatch.js:50 emits `SUBSCRIBER_FAILED: <name> <status> exit N`, and `SUBSCRIBER_SKIPPED: <name> ...`) and exits 0 by design: an unavailable observer must not block publication (docs/runbooks/release.md line 270). The OpenCode plugin's spawnHook (integrations/opencode/hook.js lines 19-27) counts hook stderr bytes only for the 64 KiB cap and discards the content, and the queue (queue.js:14-15) logs one sanitized code only when the hook rejects: nonzero exit, timeout or spawn failure. So under OpenCode an observer failure reaches no log at all, while Claude Code and Codex surface the hook's stderr. The extraction plan fixed the constraint (docs/plans/2026-09-17-extraction.md lines 641-645): opencode-plugin.log carries event and error codes, never payloads or command text, and a child must not be able to cause raw logging. Confirmed against the working tree at a0945f1 on 2026-10-19. The plugin is still not enabled live (AGENTS.md); this task does not enable it.

Report (fam, gap): relay hook reports SUBSCRIBER_FAILED and observer stderr only as hook stderr diagnostics; the OpenCode plugin drops stderr content and logs codes only on a nonzero hook exit, which an observer failure never causes. Expected: observer failures under OpenCode reach the plugin log (code and subscriber name).

Decision the design gate settles: (a) the plugin recognises relay's own diagnostic lines on hook stderr (lines starting `SUBSCRIBER_FAILED: <name>` or `SUBSCRIBER_SKIPPED: <name>`; names come from the operator's subscribers.json, and a subscriber's own stderr is prefixed `<name>: ` by dispatch.js:51, so it cannot forge one) and logs `relay: opencode <event> SUBSCRIBER_FAILED <name>`; or (b) `relay hook` gains a machine-readable diagnostics channel (a trailing JSON line or a flag) that every harness binding can read, and the plugin logs codes from it. Rejected: a nonzero hook exit on observer failure, which would turn an observer fault into a visible hook failure under Claude Code and Codex and contradict the release contract. Lean: (a), because it changes only the plugin and relies on a line format relay already emits; (b) only if the design review decides the plugin must not depend on the human-oriented stderr format.

Done when: a failing observer under the OpenCode binding produces one plugin-log line carrying the event, SUBSCRIBER_FAILED and the subscriber name, and nothing from the subscriber's own output; integrations/opencode/hook.test.mjs and binding.test.mjs cover a failing observer, a skipped observer and a subscriber that prints a forged `SUBSCRIBER_FAILED:` line; docs/api.md's OpenCode paragraph says what the plugin log records.

Where to look: integrations/opencode/hook.js, queue.js, binding.js (logError); src/dispatch.js runObservers; bin/relay.js line 154 (how diagnostics reach stderr); docs/plans/2026-09-17-extraction.md Phase 5.
