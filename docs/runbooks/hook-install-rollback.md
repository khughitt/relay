# Hook install and recovery

Run a dry run first and inspect its JSON artifact. Apply only with an explicit artifact path and no live harness session. Claude targets are the checkout's named settings file; Codex targets the checkout's `hooks.json`, never `config.toml`.

Every installed relay entry names its outer budget twice: `--outer-ms N` in the command, which relay plans its internal deadline from, and `timeout: N / 1000` on the same hook object, which is the harness's own outer timeout in seconds. Both harnesses default an unset timeout to 600 s, so the field is written even where it repeats the default; SessionEnd carries the short profile (Claude 60 s, Codex 3 s). A relay entry whose field drifted from its command is replaced as a whole.

Every installed entry also names the subscriber file (`--subscribers '<absolute path>'`) so the harness's hook shell cannot redirect relay to another configuration; the install refuses a file that is not a 0600 regular file in a 0700 directory owned by you, or that is missing or invalid, before writing an artifact. Moving the subscriber file requires a new install.

Every installed entry also names the node that runs relay.js: the installer's own, or the one `--node PATH` names (Claude Code and Codex). A node inside a version manager's per-version directory (nvm or n, fnm, nodenv, Volta, asdf or mise, a Homebrew Cellar) disappears when that version is removed, and the harness then reports each hook as a non-blocking failure: the guards stop guarding without a visible error. `relay install` warns on stderr when the node or relay path it writes is such a path. Pass `--node` with a path that survives version changes and runs Node 22 or later (install refuses an older one: a distribution's `/usr/bin/node` can be older). A Homebrew `/opt/homebrew/bin/node` link qualifies, since `--node` writes it unresolved. In an fnm shell, `which node` prints a per-shell link that disappears with the shell; install warns about it too. Avoid a version-selecting shim (asdf, mise, nodenv, Volta) as `--node`: it chooses a version from the directory it runs in, so the version install checked is not necessarily the one each session's hook runs. Otherwise rerun the install after every Node version change. A relay checkout or global package inside a version directory has the same failure; install relay outside it.

After a Codex apply, re-trust the changed hooks in Codex. The installer never writes trust hashes.

Rollback uses only the artifact: `relay rollback --artifact FILE`. For each change, `after` restores `before`, `before` is skipped, and any other bytes refuse. A partial cutover can therefore be completed with install or recovered with rollback. OpenCode modifies only its server plugin entry; it never touches `tui.json`.

Guard/context bindings require the real evidence record produced by `ops-c8e4d1`; fixture artifacts are not live capability proof.

## Activating session handles (registry schema 2)

Before a schema-2 relay publishes on a host where tasks' relay identity is on
(`[identity] relay = true` in tasks' host config), every `tasks` binary that can run
there must carry the session-process walk shipped in tasks 0.2.0 (the tasks project
task "relay schema 2 and the session-process walk"): check each `tasks` that each
harness's environment resolves on `PATH` with `tasks --version`, not only the main
checkout's. The precondition is met only by tasks 0.2.0 or later. An older tasks refuses a schema-2 registry
for new claims, but can still continue a claim it already holds from process proof
alone, and its older walk can prove a nested session to be its parent. A host with
the opt-in off is not exposed.

After upgrading relay, run `relay reap` once. It replaces a schema-1 registry with an
empty schema-2 one and names every dropped agent on stderr; each live session
reappears with its own handle at its next hook event. No session restart is needed.
