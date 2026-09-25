---
id: relay-aa4130
title: "Darwin probe: a guard probe's token write-back is not a live-path change"
status: done
priority: 1
size: s
complexity: mid
process: direct
owner: relay-dc2b03
created: 2026-09-25T21:41:04Z
updated: 2026-09-25T21:43:00Z
started: 2026-09-25T21:41:04Z
completed: 2026-09-25T21:43:00Z
depends: []
parent: relay-1231bf
tags: [darwin-probe]
source: relay-dc2b03-review
agent: claude-code/claude-opus-5-5
---

ops 1169107 (ops-4130ea) writes a harness's refreshed login back to ~/.codex/auth.json (or ~/.claude/.credentials.json) after its live runs. The probe's isolation check watches both files as a release gate, so any Codex token refresh during D7 would fail ISO on attempt 3. D7 fingerprints the harness's credential file just before and after the ops probe's live run; isolationOf removes that path from 'changed' only when the run-wide before/after readings equal D7's own, and reports it as written_back (a finding). Rejected: unwatching auth.json, which would hide a real probe write.

## Notes

- 2026-09-25T21:41:04Z (relay-dc2b03): started
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:43:00Z (relay-dc2b03): done
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
- 2026-09-25T21:43:00Z (relay-dc2b03): D7 fingerprints the harness's live login file around the ops probe's live run; isolationOf reports a change matching those readings as written_back (an ISO finding) and still gates any other change
  provenance: {"harness_session":"claude-code:3c606fb5-d94a-4c2d-b41f-4c120db27c0d","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
