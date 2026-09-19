# Hook install and recovery

Run a dry run first and inspect its JSON artifact. Apply only with an explicit artifact path and no live harness session. Claude targets are the checkout's named settings file; Codex targets the checkout's `hooks.json`, never `config.toml`.

Every installed relay entry names its outer budget twice: `--outer-ms N` in the command, which relay plans its internal deadline from, and `timeout: N / 1000` on the same hook object, which is the harness's own outer timeout in seconds. Both harnesses default an unset timeout to 600 s, so the field is written even where it repeats the default; SessionEnd carries the short profile (Claude 60 s, Codex 3 s). A relay entry whose field drifted from its command is replaced as a whole.

Every installed entry also names the subscriber file (`--subscribers '<absolute path>'`) so the harness's hook shell cannot redirect relay to another configuration; the install refuses a file that is not a 0600 regular file in a 0700 directory owned by you, or that is missing or invalid, before writing an artifact. Moving the subscriber file requires a new install.

After a Codex apply, re-trust the changed hooks in Codex. The installer never writes trust hashes.

Rollback uses only the artifact: `relay rollback --artifact FILE`. For each change, `after` restores `before`, `before` is skipped, and any other bytes refuse. A partial cutover can therefore be completed with install or recovered with rollback. OpenCode modifies only its server plugin entry; it never touches `tui.json`.

Guard/context bindings require the real evidence record produced by `ops-c8e4d1`; fixture artifacts are not live capability proof.
