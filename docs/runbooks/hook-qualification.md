# Hook route qualification

Type: operator guide; document types 1.

How to produce the latency evidence a HookQualification row's `latency` check needs ([adapters.md](../adapters.md#route-qualification)). The runner and judge launch only local synthetic processes: no model, harness session or network request, and no host settings change. The results are **transport evidence**: fixture programs stand in for policy commands, so a policy route's own cost is replayed by its owner before that policy's cutover. The frozen workload and Binding bounds are `scripts/hook-qualification/workload.json` (`qualification`); changing a bound needs a reviewed plan amendment before any remeasurement.

## Inputs

1. **Fixture programs.** `node scripts/hook-qualification/run.mjs --prepare --output DIR` writes `DIR/fixture/bin` (guard, notice, observer, native reader and the timeout program with a grandchild) and `DIR/fixture/programs.json`, which records each program's digest and the digest of the work it does apart from its reply encoding. Write subscriber configs under `DIR/fixture/config` (0600 files in a 0700 directory) naming those programs: schema 1 with absolute paths for a deployed relay, schema 2 with basenames for the candidate.
2. **A manifest set per host** (`{schema: 1, host, manifests: [...]}`), one frozen manifest per route in `scripts/hook-qualification/baseline.mjs`'s shape plus:
   - `inventory.relayedEvents`: the events the host's deployed settings already run through relay, read from the active settings file. An event listed there is measured against `deployed-relay-plus-native`; any other against `native-only`.
   - `fixture` (the fixture directory, relative to the set file), `candidate.config` and its `candidate.configSha256`, `payload` (the native payload object) and optional `padField` (the path of a string field padded to the declared input size).
   - for a deployed baseline: `deployed.config` (the fixture config the deployed relay runs), `deployed.fileList` (the frozen `sha256  path` list of the deployed package's `package.json`, `bin/` and `src/`, whose sha256 is `deployed.packageSha256`) and `deployed.outerMs`.
   - branch `argv` may use `@NODE@`, `@DEPLOYED@`, `@FIXTURE@`, `@CONFIG@` and `@CANDIDATE@`; a native branch names its fixture program in `fixture` and says whether the cutover replaces it (`migrates`). A branch with `migrates: false` runs unchanged on both sides.
   - `noSubscriber.candidate` (and `noSubscriber.deployed` for a deployed baseline): empty configs for the required no-subscriber diagnostic.

   Each host freezes its own manifest from its own deployment; never reuse another host's manifest or deployed identity.

### Freeze a Claude Code Stop or SessionStart manifest

Prepare the fixture programs with `run.mjs --prepare` and keep the route inputs together in a private scratch directory. Use a schema-1 set containing one route template. Keep its session mode, schedule evidence, payload, branch definitions, replacement map, candidate config digest and no-subscriber config names. The template uses `fixture: "fixture"` and includes a `deployed-relay` branch. Put the normalized schema-2 candidate and empty configs beside the template, along with `deployed-stop.json` or `deployed-sessionstart.json`, which substitutes fixture commands for the selected deployed subscribers. Keep the original config bytes for each input so the candidate digest matches.

From the measurement host, give the freezer a saved snapshot of the active settings and either of these settings records.

- `--settings-identity FILE` reuses a frozen `settings` record with `repository: "hq"`, `commit`, `path` (relative to hq), `blob` and `liveSha256`. An optional `from` names the earlier capture. The freezer checks the snapshot digest, hq HEAD, the committed blob and the cleanliness of that path. It reads the saved snapshot directly.
- `--settings-source FILE` uses an operator capture. If the host's settings are unavailable over SSH, its operator saves the active settings bytes and a separate text file containing the resolved absolute source path within their hq checkout. The freezer checks that the source maps to a clean committed path and records the snapshot digest and the checkout identity. Use the snapshot and source from the same capture.

```sh
node scripts/hook-qualification/run.mjs --prepare --output PREPARED
node scripts/hook-qualification/freeze.mjs \
  --snapshot CAPTURE --settings-identity IDENTITY --hq HQ_CHECKOUT \
  --version HARNESS_VERSION --template ROUTE_TEMPLATE \
  --fixture PREPARED/fixture --output NEW_BUNDLE
```

Use `stop-manifest.json` or `sessionstart-manifest.json` in the new bundle as the pilot's manifest set. The freezer prints its SHA-256 and keeps the deployed package, raw config and package hash list beside it. The bundle is local to the capture host, with fixture configs written as 0600 in a 0700 directory. Use a new bundle directory for each capture.

The route map uses the observed handler order and refuses a changed matcher, command shape or composition. For SessionStart, one `claude-sessionstart` handler maps to the halt, stale-lore and index-repair fixture branches in that order. They run in parallel under the existing qualification schedule, preserving the conservative baseline from the SessionStart timing proof. Extend the map and supply a matching template and configs when adding a route or changing its native composition. The manual manifest format above also supports routes outside this map.

## Pilot, then measure

Run every command from a checkout at the candidate commit, once with Node 22 and once with the development runtime:

```sh
node scripts/hook-qualification/run.mjs --candidate CHECKOUT --baseline-manifest SET --workload scripts/hook-qualification/workload.json --output OUT --pilot
node scripts/hook-qualification/run.mjs --candidate CHECKOUT --baseline-manifest SET --workload scripts/hook-qualification/workload.json --output OUT --measure
```

`--pilot` runs one case of every condition (supervisor alone, warm, fresh-process cold, missing first command, timeout with grandchild, a concurrent batch and the no-subscriber diagnostic) and reports each problem; read it before measuring. `--measure` runs the frozen counts. `--route HARNESS:EVENT` (repeatable) selects routes; it never changes their workload. Each route runs in its own process under the table's 10-minute wall bound and names itself for the harness by writing the harness command to its `/proc` comm. The name is written after startup because Node 24 and later rename the main thread then (for example `node-MainThread`). Its command line stays the runner's own. Before timing anything, the route checks that a hook-shaped child (a node process under `/bin/sh`, resolving with the candidate's adapter) finds the route process itself as its session. A route whose hooks would resolve no session, or an outer one such as the Claude Code session that launched the runner, refuses. Each result records that check as `harnessAncestor`, and the judge fails a result without a passing one. The route writes `OUT/<harness>-<event>/<runtime>.json` with raw samples, load snapshots, the candidate commit, the manifest set's digest and the fixture work digests. A rerun skips a route already written for the same commit, manifest set and mode; never mix samples from different runs. The runner owns cleanup of every process it starts, including baseline branches and the timeout program's grandchild: it records survivors before reaping them and marks that sample failed.

Measure on an otherwise idle host. A contested host gives unusable evidence and an operator scheduling action, not a pass; a refused or failed run is diagnosed from what it completed before any rerun.

## Judge

`node scripts/hook-qualification/judge.mjs RESULT.json...` judges one route from every host's and runtime's result and exits `0` only when it passes: at least two hosts, each with a Node 22 and a development-runtime run, one clean candidate commit and config, each host against its own manifest and its exact deployed package, the harness's verified branch scheduling (Claude Code runs matching hooks in parallel), the replacement map's work on both sides with the same fixture work per invocation, every condition's exact sample count with no failed, excluded or surviving call and no candidate failure diagnostic, warm samples in one runtime directory and every cold sample in its own, and every bound. One host's results never qualify a route. Its `evidence` lines (`host=NAME outerMs=N runtime=... commit=...`, naming the budget measured) are what the HookQualification row's `latency` check cites; a failed route keeps `latency` non-passed with an open owner and the failing bound as its reason.

## Another host

For a host this session cannot run on, hand its operator the candidate commit, the route template, fixture config inputs and this guide. The operator captures that host's own settings and deployment, prepares and freezes the fixture bundle, runs the pilot and the measurement on both runtimes, and returns the `OUT` directory. Its results join the judge beside this host's.

## A new harness version

The runner launches no harness, so a passed two-host result can carry to a later version of the same harness instead of being remeasured (design revision 6). The latency column of a row at version B, for the same session mode, platform, event and role and an outer budget no smaller than the measured one, may cite a result measured at version A only when all four conditions hold against that measurement's own frozen inputs, never against an earlier carry:

1. **Relay commit.** The row's tested relay commit is the commit both hosts measured.
2. **Hook wiring.** On each host, the event's native hook lines (commands, order, timeouts), the deployed relay artifact and its subscriber config are unchanged from that host's frozen manifest, checked against the settings-source and artifact identities the manifest recorded.
3. **Scheduling.** How the harness runs matching hooks for the event (the judge's `schedules` kind, parallel for Claude Code) is re-verified for B, from its cited source or a live probe.
4. **Input.** B's decoded-fixture check passes on the same fixtures the measurement replayed, and the frozen payload bound is unchanged.

The carried check keeps the measured hosts' `evidence` lines and adds one line naming version A, the measured commit and how each condition was established. If any condition fails or cannot be established, latency stays `unknown` at B with an open owner until both hosts are remeasured. Never carry one host and remeasure the other. A carry covers latency only: every column that needs a live probe still needs one at B.

## Live native probes

Fixture results never fill `liveDelivery`, `retryFlag`, `outerFailure` or a native context limit. Those columns need a live probe on the exact harness version and session mode, recorded with that version, mode, platform, the tested relay commit and the source (a transcript excerpt or the harness's own record). Each probe below is an ordinary human-driven interactive session: it starts no automated or metered run, needs the host-use grant that applies at the time, and installs relay only into a scratch configuration (a separate settings file or harness profile pointed at a scratch relay state directory), never the host's live hooks. A probe that cannot be run, or whose result is unclear, leaves its column `unknown` with an open owner; it is never inferred from a fixture.

1. **Fresh SessionStart context (Claude Code, Codex).** Install only the SessionStart route with one notice whose context is a unique marker. Start a fresh session (not a resume) and ask it to repeat any marker it was given at startup. Passed when the marker is reported verbatim; record the context length that was delivered. Repeat with a resume where the matcher includes it.
2. **agy injectSteps.** With the agy settings generator's SessionStart and PreInvocation routes and a notice marker, start a session and confirm the marker arrives as an injected system message; then run a second turn and confirm it is not repeated where the route should deliver once.
3. **Stop and SubagentStop retry after an infrastructure refusal (Claude Code, Codex).** Install the route with a guard whose command is missing (`EXECUTABLE_NOT_FOUND`), so relay refuses the first stop. Passed when the harness retries with `stop_hook_active: true`, relay lets that retry stop, and the session ends without a loop. SubagentStop is probed separately, with a subagent; Stop's result never stands for it.
4. **Externally killed or timed-out relay.** Install a route whose only guard hangs, and lower the harness's own outer timeout for that entry below the guard timeout; separately, kill the relay hook process from another terminal while it waits. Record what the harness does with the unreplied hook (proceeds, blocks, reports) and that `relay reap` afterwards finds no surviving subscriber group. This is the native outer-failure behavior, observed, not relay's fallback.
5. **agy multi-turn reset and wake.** Over several turns, with relay's agy Stop route installed through the generator, confirm `fullyIdle` and `executionNum` transitions reach relay's registry row as the native fields say, and that a wake after idle resumes the same conversation's row rather than creating another.
6. **Claude task provenance (Claude Code).** Launch from an empty scratch project with no ancestor `.claude` settings and no managed settings: `claude --setting-sources project,local --settings "$SCRATCH_SETTINGS"`, where the scratch settings hold only relay's SessionStart and PostModelSwitch routes (`node <checkout>/bin/relay.js hook --harness claude-code --subscribers <0600 file in a 0700 dir> <EVENT>`, with `RELAY_STATE_DIR` set to a private 0700 directory). Unset `TASKS_AGENT` and `TASKS_MODEL` in the launching shell. `/hooks` lists only user, project, local and plugin hooks, so it shows `0 with hooks` here: that proves no other provenance writer (such as ops `claude-provenance`) is loaded, while the private registry entry for the session proves relay's SessionStart route ran. Then run `printf '%s|%s|%s\n' "$TASKS_AGENT" "$TASKS_MODEL" "$CLAUDE_CODE_SESSION_ID"`, switch with `/model`, and run it again. Passed when the first shows `claude-code/<startup model>`, the second the new model with the same session ID, the session's env file (`~/.claude/session-env/<session>/sessionstart-hook-*.sh`) holds exactly one relay reader stanza and was not rewritten by the switch, and the scratchpad `tasks-model` (mode 0600) holds the new model. `CLAUDE_ENV_FILE` is visible to hooks, not to Bash commands. Observed on Claude Code 2.1.325, Linux, relay `8a46457a`.

Record each probe's outcome on the HookQualification row it proves, citing the transcript or record, and keep the raw transcript out of the repository.
