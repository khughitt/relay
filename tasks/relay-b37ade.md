---
id: relay-b37ade
title: Type-check relay's JavaScript with tsc --checkJs and JSDoc types
status: todo
priority: 2
size: m
complexity: mid
process: direct
created: 2026-10-12T00:40:45Z
updated: 2026-10-12T00:40:45Z
depends: []
tags: [tooling]
agent: claude-code/claude-opus-5-5
---

Relay is plain JavaScript with no checker, and relay-f58531's plan passes many object shapes (entries, messages, socket replies, Results) between modules; a type mismatch between neighbouring tasks is caught today only by review or a failing test.

Approach (settled 2026-10-11 in the relay-f58531 session):
- Keep .js sources: Node refuses to strip types from .ts files under node_modules, and familiar consumes relay as an installed package, so .ts sources would need a build step. JSDoc types plus // @ts-check give checking with no build and no runtime change.
- Add typescript as a devDependency only (runtime stays Node built-ins plus jsonc-parser); amend AGENTS.md's one-dependency line to say it counts runtime dependencies.
- tsconfig.json: allowJs, checkJs, noEmit, strict, module/moduleResolution nodenext, target es2023, types node (@types/node as a second devDependency, pinned to the Node 22 floor's major).
- Run tsc --noEmit in check_cmd so just check and the pre-commit hook enforce it.
- Type the shared shapes first, in one place (src/types.js typedefs: Handle, Agent, Snapshot, Event, Message, Entry, Result), then turn on @ts-check file by file; a file may land unchecked only with a note naming why.

Done: just check runs tsc and passes on main; every src/ and bin/ file is checked; AGENTS.md states the dependency rule; the Node 22 gate still passes.

Ordering with relay-f58531: independent. If it lands before that plan's Task 2, the plan's new modules carry JSDoc types from the start; if after, it types them with the rest.
