# Hook install and recovery

Type: operator guide; document types 1.

Run a dry run first and inspect its JSON artifact. Apply only with an explicit artifact path and no live harness session. Claude targets are the checkout's named settings file; Codex targets the checkout's `hooks.json`, never `config.toml`.

Every installed relay entry names its outer budget twice: `--outer-ms N` in the command, which relay plans its internal deadline from, and `timeout: N / 1000` on the same hook object, which is the harness's own outer timeout in seconds. Both harnesses default an unset timeout to 600 s, so the field is written even where it repeats the default; SessionEnd carries the short profile (Claude 60 s, Codex 3 s). A relay entry whose field drifted from its command is replaced as a whole.

Every installed entry also names the subscriber file (`--subscribers '<absolute path>'`) so the harness's hook shell cannot redirect relay to another configuration; the install refuses a file that is not a 0600 regular file in a 0700 directory owned by you, or that is missing or invalid, before writing an artifact. Moving the subscriber file requires a new install.

Every installed entry also names the node that runs relay.js: the installer's own, or the one `--node PATH` names (Claude Code and Codex). A node inside a version manager's per-version directory (nvm or n, fnm, nodenv, Volta, asdf or mise, a Homebrew Cellar) disappears when that version is removed, and the harness then reports each hook as a non-blocking failure: the guards stop guarding without a visible error. `relay install` warns on stderr when the node or relay path it writes is such a path. Pass `--node` with a path that survives version changes and runs Node 22 or later (install refuses an older one: a distribution's `/usr/bin/node` can be older). A Homebrew `/opt/homebrew/bin/node` link qualifies, since `--node` writes it unresolved. In an fnm shell, `which node` prints a per-shell link that disappears with the shell; install warns about it too. Avoid a version-selecting shim (asdf, mise, nodenv, Volta) as `--node`: it chooses a version from the directory it runs in, so the version install checked is not necessarily the one each session's hook runs. Otherwise rerun the install after every Node version change. A relay checkout or global package inside a version directory has the same failure; install relay outside it.

After a Codex apply, re-trust the changed hooks in Codex. The installer never writes trust hashes.

Rollback uses only the artifact: `relay rollback --artifact FILE`. For each change, `after` restores `before`, `before` is skipped, and any other bytes refuse with `TARGET_DRIFT` naming the path (a symlink or non-file target refuses with `UNSAFE_TARGET`), exit `1`, before that file is touched. A partial cutover (an apply interrupted between targets, or a selected-event install) can therefore be completed with install or recovered with rollback. OpenCode modifies only its server plugin entry; it never touches `tui.json`.

Guard/context bindings require the real capability evidence record for the installed harness version; fixture artifacts are not live capability proof.

Dispatch bindings also require a HookQualification record (`--qualification FILE --session-mode MODE`) whose rows match the installed harness version, the session mode, the platform, the commit this relay was installed from and the subscriber file's digest ([adapters.md](../adapters.md#route-qualification)). `--event NAME` installs only the routes that qualify and leaves every other entry, native and relay alike, as it was.

## Cutover with a retained rollback pair

Applying a cutover changes a live harness surface: it needs explicit activation authority at the time, and runs with no live session of the affected harness. Native hook lines (policy commands, ask and connector routes) stay until their owner's policy-equivalence proof passes; an install never removes a native line because its command's basename matches a subscriber. Every value below is data from the authorized installation, recorded in its task, not a literal from this guide.

1. **Prepare the new pair beside the prior one.** Install the new relay at a new versioned path (for example a fresh npm prefix per version, so its lock names the installed commit) and write its schema-2 subscriber file at a new versioned path (a 0600 file in a 0700 directory). Never rewrite the prior relay or its subscriber file in place: `install` refuses (`PAIR_NOT_RETAINED`) to give the prior relay's subscriber file to the new relay.
2. **Record the prior pair.** `node NEW_RELAY pairs --harness HARNESS --target SETTINGS > PRIOR_PAIRS` records each pinned node, relay and subscriber file with its digests. Keep the prior node, relay installation and subscriber file unchanged until the cutover is retired.
3. **Prove the prior pair still runs.** Run the prior relay against its own subscriber file outside the harness, with the plan-only install of a scratch target (`node PREVIOUS_RELAY install --harness HARNESS --subscribers PREVIOUS_CONFIG --target SCRATCH`, adding the flags that relay's own version requires), and confirm it exits `0` without writing the scratch file. The new relay rejects a schema-1 file with its migration message; the prior relay may reject the new file; neither is ever pointed at the other's file.
4. **Plan, then apply the cutover.** `node NEW_RELAY install --harness HARNESS --subscribers NEW_CONFIG --target SETTINGS --qualification QUALIFICATION --session-mode MODE [--event NAME]...` prints the artifact; inspect it, then rerun with `--apply --artifact CUTOVER_ARTIFACT`. A selected-event cutover leaves the other events on the prior pair; `relay pairs` then lists both.
5. **Freeze the recovery command** in the task before any session runs the new hooks: `PRIOR_NODE PREVIOUS_RELAY rollback --artifact CUTOVER_ARTIFACT`, run outside the affected harness (from another terminal or harness), using the retained prior node and relay. It needs nothing the cutover changed.
6. **After a rollback,** compare `node PREVIOUS_RELAY pairs` output (or the new relay's, if the prior relay predates `pairs`) with `PRIOR_PAIRS`: every pinned digest matches, and the settings file's bytes equal the artifact's `before` image. A rerun of the rollback skips a restored target; a target edited since the cutover refuses with `TARGET_DRIFT` and is left untouched for the operator.

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

## Activating Codex worker rows

Codex workers get their own registry rows (`scope: "worker"`, see
[adapters.md](../adapters.md#event-mappings)). Before relay hooks run under Codex on a
host where tasks' relay identity is on:

1. Every `tasks` binary each harness resolves on `PATH` carries the worker-scope and
   thread-hint tie-break change (the tasks project task "Accept relay Codex worker rows:
   worker scope and thread-hint tie-break"). An older tasks refuses the whole registry
   while any worker row exists, Claude sessions included.
2. Every relay writer on the host resolves to a relay with worker rows: the installed
   hook command of every harness (Claude Code settings, Codex `hooks.json`, the OpenCode
   plugin when enabled), every `relay reap`, and every package that depends on relay and
   calls `applyEvent` or `reapRegistry` (familiar pins its own). List each writer with
   the relay path it runs. An older writer refuses a snapshot holding a worker row with
   `INVALID_SCHEMA` and writes nothing: its hook reports the diagnostic, its observers
   are skipped, and `relay reap` and `relay list` fail until it is upgraded.
3. Install the Codex hooks, which now include SubagentStart and SubagentStop. A guard on
   Codex `turn-end` needs a passed SubagentStop refusal probe in `--evidence` as well as
   Stop's. Re-trust the changed hooks in Codex.
