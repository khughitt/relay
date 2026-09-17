# Hook install and recovery

Run a dry run first and inspect its JSON artifact. Apply only with an explicit artifact path and no live harness session. Claude targets are the checkout's named settings file; Codex targets the checkout's `hooks.json`, never `config.toml`.

After a Codex apply, re-trust the changed hooks in Codex. The installer never writes trust hashes.

Rollback uses only the artifact: `relay rollback --artifact FILE`. For each change, `after` restores `before`, `before` is skipped, and any other bytes refuse. A partial cutover can therefore be completed with install or recovered with rollback. OpenCode modifies only its server plugin entry; it never touches `tui.json`.

Guard/context bindings require the real evidence record produced by `ops-c8e4d1`; fixture artifacts are not live capability proof.
