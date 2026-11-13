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

For a host this session cannot run on, hand its operator the candidate commit, the fixture directory and this guide; the operator freezes that host's own manifest set from its own deployment, runs the pilot and the measurement on both runtimes, and returns the `OUT` directory. Its results join the judge beside this host's.

## Live native probes

Fixture results never fill `liveDelivery`, `retryFlag`, `outerFailure` or a native context limit. Those columns need a live probe on the exact harness version and session mode, recorded with that version, mode, platform, the tested relay commit and the source (a transcript excerpt or the harness's own record). Each probe below is an ordinary human-driven interactive session: it starts no automated or metered run, needs the host-use grant that applies at the time, and installs relay only into a scratch configuration (a separate settings file or harness profile pointed at a scratch relay state directory), never the host's live hooks. A probe that cannot be run, or whose result is unclear, leaves its column `unknown` with an open owner; it is never inferred from a fixture.

1. **Fresh SessionStart context (Claude Code, Codex).** Install only the SessionStart route with one notice whose context is a unique marker. Start a fresh session (not a resume) and ask it to repeat any marker it was given at startup. Passed when the marker is reported verbatim; record the context length that was delivered. Repeat with a resume where the matcher includes it.
2. **agy injectSteps.** With the agy settings generator's SessionStart and PreInvocation routes and a notice marker, start a session and confirm the marker arrives as an injected system message; then run a second turn and confirm it is not repeated where the route should deliver once.
3. **Stop and SubagentStop retry after an infrastructure refusal (Claude Code, Codex).** Install the route with a guard whose command is missing (`EXECUTABLE_NOT_FOUND`), so relay refuses the first stop. Passed when the harness retries with `stop_hook_active: true`, relay lets that retry stop, and the session ends without a loop. SubagentStop is probed separately, with a subagent; Stop's result never stands for it.
4. **Externally killed or timed-out relay.** Install a route whose only guard hangs, and lower the harness's own outer timeout for that entry below the guard timeout; separately, kill the relay hook process from another terminal while it waits. Record what the harness does with the unreplied hook (proceeds, blocks, reports) and that `relay reap` afterwards finds no surviving subscriber group. This is the native outer-failure behavior, observed, not relay's fallback.
5. **agy multi-turn reset and wake.** Over several turns, with relay's agy Stop route installed through the generator, confirm `fullyIdle` and `executionNum` transitions reach relay's registry row as the native fields say, and that a wake after idle resumes the same conversation's row rather than creating another.

Record each probe's outcome on the HookQualification row it proves, citing the transcript or record, and keep the raw transcript out of the repository.
