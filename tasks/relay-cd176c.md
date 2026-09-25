---
id: relay-cd176c
title: "Darwin probe: derive comm_kind from the argv0 case and record harness stderr in D7"
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-09-25T18:48:36Z
updated: 2026-09-25T18:50:33Z
depends: []
parent: relay-1231bf
tags: []
source: relay-b12132
agent: claude-code/claude-opus-5-5
---

From Mac attempt 2: (1) D4's comm_kind compares the chain parent's comm with its full path, but that parent was started with argv[0] equal to its path, so it cannot tell path from argv0; the native case (argv0 '9.9.9') shows Darwin comm is argv[0]. Derive comm_kind from the native capture and correct the D4 finding text. (2) D7 recorded only the ops probe's exit for codex's failed live run (allow: exit 1 after 38 s, no shell tool); copy the head of each run's stderr/stdout (runs/<attempt>/<name>/) into logs/D7.log so a failed harness run is diagnosable from the results tarball (redaction applies). (3) Warn in run's banner that the ops probe copies ~/.codex/auth.json into a disposable home, where a token refresh can rotate the refresh token.

## Notes

- 2026-09-25T18:50:33Z (main): Item (3) resolved as a cause, not a banner: the user confirmed codex required a fresh login after attempt 2. The ops guard probe deletes its disposable auth.json copy after codex refreshed (rotated) the token in it; filed as ops-4130ea. Attempt 2's codex allow failure is that stale token. Items (1) and (2) stand.
