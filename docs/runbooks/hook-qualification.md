# Hook route qualification

Type: operator guide; document types 1.

How to produce the latency evidence a HookQualification row's `latency` check needs ([adapters.md](../adapters.md#route-qualification)). The runner and judge launch only local synthetic processes: no model, harness session or network request, and no host settings change. The results are **transport evidence**: fixture programs stand in for policy commands, so a policy route's own cost is replayed by its owner before that policy's cutover. The frozen workload and Binding bounds are `scripts/hook-qualification/workload.json` (`qualification`); changing a bound needs a reviewed plan amendment before any remeasurement.

## Inputs

1. **Fixture programs.** `node scripts/hook-qualification/run.mjs --prepare --output DIR` writes `DIR/fixture/bin` (guard, notice, observer, native reader and the timeout program with a grandchild) and `DIR/fixture/programs.json`, which records each program's digest and the digest of the work it does apart from its reply encoding. Write subscriber configs under `DIR/fixture/config` (0600 files in a 0700 directory) naming those programs: for a deployed relay, in the schema that relay reads; for the candidate, a schema-3 **template**.

   A template's `searchPath` names `@WORK@/bin` (the route's own directory, which holds the timeout program), `@FIXTURE@/bin` and the system directories, for example `["@WORK@/bin", "@FIXTURE@/bin", "/usr/bin", "/bin"]`. A placeholder is accepted only as exactly one of those two entries, so one template and one digest serve every host. The runner writes each host's copy with absolute paths, loads it with the candidate's own loader and records both digests (`candidate.configSha256` for the template, `candidate.measuredConfigSha256` for the copy). Before any sample it resolves every subscriber of the measured, empty, speculative and failure configs with the candidate's own resolver, and refuses the run (`candidate subscriber NAME selects PATH, not the prepared program`) unless each selects the prepared program with its recorded digest; the missing-command subscriber alone must select none. What it credits is the program selected (`candidate.selected`), not a name on `PATH`: the candidate relay's own hook runs with a `PATH` that holds no fixture program. The baseline and the native branches the candidate keeps run with the controlled `PATH`.

   This runner measures schema-3 candidates only; measure an earlier relay with the scripts of a commit that reads its schema. A deployed baseline of schema 3 is validated but not bound: its file can select another program than the fixture's, and the runner would still credit the fixture's. No deployed relay reads schema 3 yet; bind that side before the first qualification against one that does.
2. **A manifest set per host** (`{schema: 1, host, manifests: [...]}`), one frozen manifest per route in `scripts/hook-qualification/baseline.mjs`'s shape plus:
   - `inventory.relayedEvents`: the events the host's deployed settings already run through relay, read from the active settings file. An event listed there is measured against `deployed-relay-plus-native`; any other against `native-only`.
   - `fixture` (the fixture directory, relative to the set file), `candidate.config` (the template) and its `candidate.configSha256`, `payload` (the native payload object) and optional `padField` (the path of a string field padded to the declared input size).
   - for a deployed baseline: `deployed.config` (the fixture config the deployed relay runs), `deployed.fileList` (the frozen `sha256  path` list of the deployed package's `package.json`, `bin/` and `src/`, whose sha256 is `deployed.packageSha256`) and `deployed.outerMs`.
   - branch `argv` may use `@NODE@`, `@DEPLOYED@`, `@FIXTURE@`, `@CONFIG@` and `@CANDIDATE@`; a native branch names its fixture program in `fixture` and says whether the cutover replaces it (`migrates`). A branch with `migrates: false` runs unchanged on both sides.
   - `noSubscriber.candidate` (and `noSubscriber.deployed` for a deployed baseline): empty configs for the required no-subscriber diagnostic.

   Each host freezes its own manifest from its own deployment; never reuse another host's manifest or deployed identity.

### Freeze a Claude Code Stop or SessionStart manifest

Prepare the fixture programs with `run.mjs --prepare` and keep the route inputs together in a private scratch directory. Use a schema-1 set containing one route template. Keep its session mode, schedule evidence, payload, branch definitions, replacement map, candidate config digest and no-subscriber config names. The template uses `fixture: "fixture"` and includes a `deployed-relay` branch. Put the normalized candidate template and both sides' empty configs beside the route template, along with `deployed-stop.json` or `deployed-sessionstart.json`, which substitutes fixture commands for the selected deployed subscribers. Each side's files use its own relay's schema, so the two empty configs differ when the schemas do. Keep the original config bytes for each input so the candidate digest matches.

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

Use `stop-manifest.json` or `sessionstart-manifest.json` in the new bundle as the pilot's manifest set. The freezer prints its SHA-256 and keeps the deployed package, raw config and package hash list beside it. The deployed configuration and the deployed fixture configs are validated and matched by that captured package's own exports, the candidate's, rendered with stand-in directories, by this checkout's, so the two sides may read different subscriber schemas. The candidate files in the bundle are the templates, byte for byte. The bundle is local to the capture host, with fixture configs written as 0600 in a 0700 directory. Use a new bundle directory for each capture.

The route map uses the observed handler order and refuses a changed matcher, command shape or composition. For SessionStart, one `claude-sessionstart` handler maps to the halt, stale-lore and index-repair fixture branches in that order. They run in parallel under the existing qualification schedule, preserving the conservative baseline from the SessionStart timing proof. Extend the map and supply a matching template and configs when adding a route or changing its native composition. The manual manifest format above also supports routes outside this map.

## Pilot, then measure

Run every command from a checkout at the candidate commit, once with Node 22 and once with the development runtime:

```sh
node scripts/hook-qualification/run.mjs --candidate CHECKOUT --baseline-manifest SET --workload scripts/hook-qualification/workload.json --output OUT --pilot
node scripts/hook-qualification/run.mjs --candidate CHECKOUT --baseline-manifest SET --workload scripts/hook-qualification/workload.json --output OUT --measure
```

`--pilot` runs one case of every condition (supervisor alone, warm, fresh-process cold, missing first command, timeout with grandchild, a concurrent batch and the no-subscriber diagnostic) and reports each problem; read it before measuring. `--measure` runs the frozen counts. `--route HARNESS:EVENT` (repeatable) selects routes; it never changes their workload. Each route runs in its own process under the table's 10-minute wall bound and names itself for the harness by writing the harness command to its `/proc` comm. The name is written after startup because Node 24 and later rename the main thread then (for example `node-MainThread`). Its command line stays the runner's own. Before timing anything, the route checks that a hook-shaped child (a node process under `/bin/sh`, resolving with the candidate's adapter) finds the route process itself as its session. A route whose hooks would resolve no session, or an outer one such as the Claude Code session that launched the runner, refuses. Each result records that check as `harnessAncestor`, and the judge fails a result without a passing one. The route writes `OUT/<harness>-<event>/<runtime>.json` with raw samples, load snapshots, the candidate commit, both candidate config digests, the programs selected, the manifest set's digest and the fixture work digests. A rerun skips a route already written for the same commit, manifest set and mode; never mix samples from different runs. The runner owns cleanup of every process it starts, including baseline branches and the timeout program's grandchild: it records survivors before reaping them and marks that sample failed.

Measure on an otherwise idle host. A contested host gives unusable evidence and an operator scheduling action, not a pass; a refused or failed run is diagnosed from what it completed before any rerun.

## Judge

`node scripts/hook-qualification/judge.mjs RESULT.json...` judges one route from every host's and runtime's result and exits `0` only when it passes: at least two hosts, each with a Node 22 and a development-runtime run, one clean candidate commit and config template, a measured config digest in every result, each host against its own manifest and its exact deployed package, the harness's verified branch scheduling (Claude Code runs matching hooks in parallel), the replacement map's work on both sides with the same fixture work per invocation, every condition's exact sample count with no failed, excluded or surviving call and no candidate failure diagnostic, warm samples in one runtime directory and every cold sample in its own, and every bound. One host's results never qualify a route. Its `evidence` lines (`host=NAME outerMs=N runtime=... commit=... template=... measured=...`, naming the budget and both candidate config digests) are what the HookQualification row's `latency` check cites; a failed route keeps `latency` non-passed with an open owner and the failing bound as its reason.

## Another host

For a host this session cannot run on, hand its operator the candidate commit, the route template, fixture config inputs and this guide. The operator captures that host's own settings and deployment, prepares and freezes the fixture bundle, runs the pilot and the measurement on both runtimes, and returns the `OUT` directory. Its results join the judge beside this host's.

## Another harness version or session mode

The runner launches no harness, so each host's installed harness version and the session mode its manifest names are recorded, not exercised, and the two hosts of one result may record different versions (design revision 7). A passed two-host result supports the latency column of a row at version V and session mode M (same platform, event and role, outer budget no smaller than the measured one) only when every condition below holds **for each host separately**, against that host's own frozen manifest, established at V and M. Support never chains: every condition is checked against the measurement's own frozen inputs, never against an earlier supported row.

1. **Relay commit.** The row's tested relay commit is the commit both hosts measured.
2. **Hook wiring.** The host's live hook lines for the event, its deployed relay artifact and its subscriber config are unchanged from its frozen manifest. For hq-managed Claude settings, which hq commits through its `harness-state` clean filter, check the recorded commit and blob, that the filtered live file equals the index (`git diff --quiet`) and the index equals HEAD (`git diff --cached --quiet`), and that the blob's `hooks` table equals the frozen snapshot's. `git status` and the live file's raw sha256 both change with stripped model and effort state. In addition, whether or not V or M differ from what the manifest recorded, the harness at V in M must select, for each matcher case of the binding, exactly the native hook entries of the frozen settings (baseline) and of the candidate settings, with their timeouts. Check this entry by entry with a selection probe (recorders in place of every command), then account for every replayed branch through the manifest's recorded fixture mapping, which may split one entry into several branches.
3. **Candidate.** The row's subscriber composition normalizes to the measured candidate config, whose digest the row's evidence names.
4. **Scheduling.** How the harness runs matching hooks for the event at V in M (the judge's `schedules` kind, parallel for Claude Code) is the kind the measurement assumed, from its cited source or a live probe.
5. **Input.** Relay at the measured commit decodes each manifest's timed input, rebuilt as the runner builds it (the run's own `cwd` and padding), to the expected decoded event recorded with the row. For every matcher case of the binding, live native payloads observed at V in M carry no decoded field or decoded entry shape that the timed input lacks. A matcher case not shown leaves latency `unknown` for the whole row.

#### Committed support-check commands

Run the decoder from a checkout containing this reviewed tooling; a historical measured checkout may predate `decode.mjs`. Pass the measured relay checkout explicitly as `--candidate` so normalization uses the measured code, and pass the exact workload file used by that measurement. Each positional argument is a manifest set, optionally followed by `=` and the fixture directory the runner actually used: `resolve(dirname(ORIGINAL_MANIFEST_SET), manifest.fixture)`. Use that override whenever an archived bundle has moved, because fixture-relative `cwd` bytes are part of the timed input. Do not substitute a `prepare.json` output path merely because it exists: the original manifest may have been frozen elsewhere, and `prepare.json` alone does not establish the runner's manifest-resolved fixture. Without the override, the tool resolves `manifest.fixture` beside the set file, as the runner does for an unmoved bundle.

```sh
node scripts/hook-qualification/decode.mjs \
  --candidate MEASURED_CHECKOUT --workload MEASURED_WORKLOAD \
  HOST_A_SET=HOST_A_MEASUREMENT_FIXTURE HOST_B_SET=HOST_B_MEASUREMENT_FIXTURE > decode-timed-inputs.json
```

The schema-1 report records each timed input's original `cwd`, total and padded byte counts, and normalized `kind`, `cwd`, `identity`, `facts` and `private` fields. An invalid decoded field, such as the padded relative `scratchpadDir`, is retained explicitly. A normalization exception produces an error entry and a nonzero exit. Use the decoded objects as the expected-event evidence; do not recreate the padding in another script.

On each host, check its own manifests against its own frozen settings snapshot and hq checkout:

```sh
node scripts/hook-qualification/wiring.mjs \
  --hq HQ_CHECKOUT --snapshot FROZEN_SETTINGS HOST_MANIFEST_SET... > wiring-HOST.out
```

This verifies a nonempty manifest set, that the executing hostname equals each set's and manifest's recorded host, hq HEAD and the settings blob, the filtered live-to-index and index-to-HEAD diffs, snapshot and blob hooks-table identity, the installed package listing and subscriber config digests, and the relay entry's outer budget. It does not read or name the harness settings link, `git status` or a raw live-settings hash, and uses `GIT_OPTIONAL_LOCKS=0`. Run it read-only on the other host through the ordinary authorized SSH route. The settings-link `readlink -f` check, when required, is a separate operator command rather than part of this tool.

For the selection probe, use a private run directory for each side and mode. The `run` command writes the expected entries before starting the harness, replaces every command in the input settings' `hooks` table while preserving its event/group/matcher/timeout structure, and loads only that hook table into the scratch home. Plugin-provided hooks and non-hook settings are not part of this check. `live.mjs` supplies the shared private-home, stub-model and two-turn driver used by this probe and the other live qualification probes; callers provide the run label and arbitrary stub reply program (text, tool call or API error), not a selection `probe.json`. Do not add a selection-specific second driver.

```sh
umask 077
mkdir -p "$RUNS"
for SIDE in baseline candidate; do
  if [ "$SIDE" = baseline ]; then SETTINGS=$BASELINE_SETTINGS; else SETTINGS=$CANDIDATE_SETTINGS; fi
  for MODE in interactive print; do
    node scripts/hook-qualification/selection.mjs run \
      --settings "$SETTINGS" --output "$RUNS/$SIDE-$MODE" \
      --side "$SIDE" --mode "$MODE" --claude "$CLAUDE"
  done
done
node scripts/hook-qualification/selection.mjs verdict \
  "$RUNS/baseline-interactive" "$RUNS/baseline-print" \
  "$RUNS/candidate-interactive" "$RUNS/candidate-print"
node scripts/hook-qualification/selection.mjs map MANIFEST_SET \
  "$RUNS/baseline-MODE" "$RUNS/candidate-MODE" EVENT
```

Set `BASELINE_SETTINGS` and `CANDIDATE_SETTINGS` to the two frozen settings files; the loop chooses the appropriate one for each side. `CLAUDE` is the exact candidate binary; omit `--claude` to resolve `claude` on PATH. Every run starts one session and one prompt, then resumes it with another prompt, using a local stub model and an allowlisted environment with no real credential. Interactive mode uses a private tmux server and no live desktop windows. The normal applicable host-use approval is still required before launching the real harness; the tools and their fixture tests do not grant it. No metered API request is made.

The verdict compares each event's actual entry indices and raw recorder payloads with `expected-entries.json`: every SessionStart entry has one `source: startup` and one `source: resume` payload, and every Stop entry has one payload before and one after the resumed session starts. Current millisecond-plus-PID filenames are joined to their recorder invocation by event, index and PID; original nanosecond archive filenames are joined by their timestamp within that invocation's start/end (or start/timeout) window. A run must use one payload format throughout, and recorder log lines must carry valid structured indices, PIDs and timestamps. Malformed or duplicate filenames, PID-less current files, mixed formats, invalid log records, unexpected start or end indices, unmatched or extra payloads, post-end replacements and repeated-in-one-turn entries fail. All time windows use exact integer nanoseconds; archive mtimes do not affect the verdict. `map` then checks every baseline and retained-candidate branch through the manifest's branch names (or an explicit branch `settingsEntry`), including one-to-many splits such as `claude-sessionstart.*`, checks native references in `replacementMap`, and requires retained candidate entries to keep the baseline command, matcher and timeout exactly.

For the timing variant, choose a sleep longer than a configured short timeout and shorter than the timeout values you need to show completing (8 s distinguishes the recorded 5 s `turn-pause` entry from the 600 s and default entries):

```sh
node scripts/hook-qualification/selection.mjs run \
  --settings BASELINE_SETTINGS --output "$RUNS/baseline-MODE-sleep8" \
  --side baseline --mode MODE --sleep 8 --claude "$CLAUDE"
node scripts/hook-qualification/selection.mjs verdict --sleep 8 "$RUNS/baseline-MODE-sleep8"
```

The timing verdict requires recorder starts and ends for longer/default entries on both turns, plus each turn's own harness debug log carrying the exact timeout diagnostic (for example `timed out after 5000ms`) for each short entry. Two diagnostics from one turn cannot stand in for the other turn. It exercises the short timeout exactly; longer/default entries establish only a lower bound, not their exact expiry. `null` and absent timeout fields both mean the harness default.

Payload size and list lengths are benchmark parameters: a passed row qualifies the binding's transport cost as timed on the benchmark, and install enforces no payload limit. The row keeps the measured hosts' `evidence` lines and adds the expected decoded event, the candidate digest and one line per host naming its recorded version and mode and how each condition was established. Those per-host support lines must not use the `host=` token: install reads every `host=` line as a measured result and requires its `outerMs=`. If any condition fails or cannot be established for either host, latency stays `unknown` with an open owner until both hosts are remeasured. Never support one host and remeasure the other. Support covers latency only: every column that needs a live probe still needs one at the exact version and mode.

## Live native probes

Fixture results never fill `liveDelivery`, `retryFlag`, `outerFailure` or a native context limit. Those columns need a live probe on the exact harness version and session mode, recorded with that version, mode, platform, the tested relay commit and the source (a transcript excerpt or the harness's own record). Each probe below is an ordinary human-driven interactive session: it starts no automated or metered run, needs the host-use grant that applies at the time, and installs relay only into a scratch configuration (a separate settings file or harness profile pointed at a scratch relay state directory), never the host's live hooks. A probe that cannot be run, or whose result is unclear, leaves its column `unknown` with an open owner; it is never inferred from a fixture.

1. **Fresh SessionStart context (Claude Code, Codex).** Install only the SessionStart route with one notice whose context is a unique marker. Start a fresh session (not a resume) and ask it to repeat any marker it was given at startup. Passed when the marker is reported verbatim; record the context length that was delivered. Repeat with a resume where the matcher includes it.
2. **agy injectSteps.** With the agy settings generator's SessionStart and PreInvocation routes and a notice marker, start a session and confirm the marker arrives as an injected system message; then run a second turn and confirm it is not repeated where the route should deliver once.
3. **Stop and SubagentStop retry after an infrastructure refusal (Claude Code, Codex).** Install the route with a guard whose command is missing (`EXECUTABLE_NOT_FOUND`), so relay refuses the first stop. Passed when the harness retries with `stop_hook_active: true`, relay lets that retry stop, and the session ends without a loop. SubagentStop is probed separately, with a subagent; Stop's result never stands for it.
4. **Externally killed or timed-out relay.** Install a route whose only guard hangs, and lower the harness's own outer timeout for that entry below the guard timeout; separately, kill the relay hook process from another terminal while it waits. Record what the harness does with the unreplied hook (proceeds, blocks, reports) and that `relay reap` afterwards finds no surviving subscriber group. This is the native outer-failure behavior, observed, not relay's fallback.
5. **agy multi-turn reset and wake.** Over several turns, with relay's agy Stop route installed through the generator, confirm `fullyIdle` and `executionNum` transitions reach relay's registry row as the native fields say, and that a wake after idle resumes the same conversation's row rather than creating another.
6. **Claude task provenance (Claude Code).** Launch from an empty scratch project with no ancestor `.claude` settings and no managed settings: `claude --setting-sources project,local --settings "$SCRATCH_SETTINGS"`, where the scratch settings hold only relay's SessionStart and PostModelSwitch routes (`node <checkout>/bin/relay.js hook --harness claude-code --subscribers <0600 file in a 0700 dir> <EVENT>`, with `RELAY_STATE_DIR` set to a private 0700 directory). Unset `TASKS_AGENT` and `TASKS_MODEL` in the launching shell. `/hooks` lists only user, project, local and plugin hooks, so it shows `0 with hooks` here: that proves no other provenance writer (such as ops `claude-provenance`) is loaded, while the private registry entry for the session proves relay's SessionStart route ran. Then run `printf '%s|%s|%s\n' "$TASKS_AGENT" "$TASKS_MODEL" "$CLAUDE_CODE_SESSION_ID"`, switch with `/model`, and run it again. Passed when the first shows `claude-code/<startup model>`, the second the new model with the same session ID, the session's env file (`~/.claude/session-env/<session>/sessionstart-hook-*.sh`) holds exactly one relay reader stanza and was not rewritten by the switch, and the scratchpad `tasks-model` (mode 0600) holds the new model. `CLAUDE_ENV_FILE` is visible to hooks, not to Bash commands. Observed on Claude Code 2.1.325, Linux, relay `8a46457a`.

Record each probe's outcome on the HookQualification row it proves, citing the transcript or record, and keep the raw transcript out of the repository.
