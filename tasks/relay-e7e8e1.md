---
id: relay-e7e8e1
title: Give install artifact refusals error codes so rollback and apply report the drifted path instead of a generic failure
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-10-19T16:20:05Z
updated: 2026-10-20T02:07:47Z
depends: []
tags: [feedback, friction, "from:fam"]
agent: codex
---

Why: src/install/atomic.js throws plain Errors with no `code`: `preimage drift: <path>`, `target must be absent: <path>`, `unsafe target: <path>` and `invalid artifact: ...`. The CLI's catch block (bin/relay.js ~line 262) maps a code-less error to the detail `relay operation failed`, so in both output modes the operator sees `{"error":{"kind":"rollback_failed","detail":"relay operation failed"}}` or `relay: relay operation failed`, never the path whose bytes match neither image. docs/api.md promises "Errors are ordinary Errors carrying code"; these break that contract. The same loss hits `install --apply`. Confirmed against the working tree at a0945f1 on 2026-10-19.

Report (fam, friction): The rollback CLI hides a postimage-drift refusal behind a generic operation failed message in both output modes, leaving the operator without the recovery cause.

Done when: atomic.js raises its refusals through relayError (src/protocol.js) with codes added to docs/api.md's code list (proposed: INVALID_ARTIFACT from validateArtifact, TARGET_DRIFT when a target matches neither image, UNSAFE_TARGET for a symlink or non-file), each message naming the path and, for drift, the image the operation expected (rollback: after; apply: before); test/install-atomic.test.js asserts the codes; test/install-cli.test.js shows `rollback --artifact` on a drifted target exiting 1 with the code and path in `error.detail` under --json and in the `relay: ` line otherwise; docs/runbooks/hook-install-rollback.md's "any other bytes refuse" sentence names the code. Keep the code-less fallback in the catch block for errors that genuinely carry none.

Where to look: src/install/atomic.js (validateArtifact, inspect, targetState); bin/relay.js catch block near line 260; docs/api.md error-code list near line 545; test/install-atomic.test.js lines 39-63; test/cli-surface.test.js rollback rows for the envelope shape.

## Notes

- 2026-10-20T02:07:47Z (main): scope: scoped; confirmed at a0945f1: atomic.js refusals carry no code and bin/relay.js:262 replaces a code-less error's message with 'relay operation failed' in both modes, against docs/api.md's 'Errors carry code' contract; rated s/low/direct; title and body rewritten, original report kept in the body
