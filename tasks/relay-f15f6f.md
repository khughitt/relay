---
id: relay-f15f6f
title: Adopt the ops template's test-one form so quoted runner arguments reach node --test intact
status: todo
priority: 2
size: xs
complexity: low
process: direct
created: 2026-10-14T22:36:05Z
updated: 2026-10-20T02:07:49Z
depends: []
tags: [feedback, friction, "from:relay"]
agent: claude-code/claude-opus-5-5
moved_from: ops-418bcd
---

Why: relay's justfile (lines 49-50) defines `test-one *args:` as `{{tt}} test-one -- node --test {{args}}` with no `set positional-arguments`, so just re-splits the interpolated text: `just test-one --test-name-pattern "an expired deadline refuses" <file>` ran 17 tests (pattern `an`, the remaining words as file arguments). The ops template (templates/justfile lines 20 and 104-105, since ops 597989f on 2026-09-28) forwards each argument intact: `set positional-arguments`, `test-one +args:` running `{{tt}} test-one -- sh -c '{{one_cmd}} "$@" 2>&1' test-one "$@"`; the earlier scope note found 15 of 17 project recipes already use that form. The `2>&1` is for runners that report on stderr; node --test reports on stdout, so tt's count is unaffected either way. Confirmed against the working tree at a0945f1 on 2026-10-19.

Report (relay, friction): just test-one --test-name-pattern "an expired deadline refuses" <file> ran 17 tests (pattern 'an') instead of 1; expected the quoted argument to arrive intact (e.g. set positional-arguments and "$@"). Filed as ops-418bcd and moved here on 2026-10-15 because the unquoted recipe is relay's own.

Done when: relay's justfile declares `one_cmd := "node --test"` and the template's `test-one +args` recipe under `set positional-arguments`; `just test-one --test-name-pattern "an expired deadline refuses" <file>` runs exactly one test; `just test-fast` still records through tt; AGENTS.md's gates sentence names the test-one forms node --test accepts (a file path, `--test-name-pattern <regex>`), as the template asks.

Where to look: justfile lines 17-50; ops templates/justfile lines 20, 59-72 and 96-105; `git -C <ops> show 597989f`; AGENTS.md "Verify through just test-fast" line.

## Notes

- 2026-10-15T12:34:49Z (main): scope: drop; the ops front-door template has forwarded test-one arguments intact since 597989f (2026-09-28: set positional-arguments, sh -c '... "$@"' test-one "$@"), and 15 of 17 project test-one recipes use that form. The unquoted recipe is relay's own justfile:49-50 (test-one *args: node --test {{args}}, no set positional-arguments). obs's justfile:8-9 is also unquoted, and unwrapped by tt. Fix belongs to relay; proposal: move to relay with tasks move ops-418bcd --to relay (adopt the template's test-one form), or drop here naming relay as owner
- 2026-10-15T12:37:17Z (main): moved from ops-418bcd
  provenance: {"harness_session":"claude-code:975fb220-f6ce-4fc5-b44f-6fba336111ae","harness_session_source":"CLAUDE_CODE_SESSION_ID"}
