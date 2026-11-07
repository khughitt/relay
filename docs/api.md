# Relay API

Type: guide, data model; document types 1.

`relay` provides normalized agent lifecycle observation, a host-local live-agent registry (`agents.json`), a hook guard and observer dispatcher, and a durable interaction inbox (`relay serve`, `relay ask`, `relay inbox`, `relay presence`). Direct `applyEvent` performs no policy check; `dispatchHook` runs configured guards before optional enrichment and registry publication and retains their decision when observation fails. No live hooks or plugins are registered by installing the package alone.

Runtime floor: Node >=22, ES modules, Node built-ins. No install lifecycle scripts. The one runtime dependency, `jsonc-parser`, is installed by npm with `relay` and used only by `relay install`.

Package `"relay"` exports (`package.json`):

- `.` (`./src/index.js`): named root exports documented below.
- `./opencode` (`./integrations/opencode/plugin.js`): the async OpenCode plugin function (`Relay`).
- `./fixtures/handles.json` (`./test/fixtures/handles.json`): portable process-handle schema fixtures.
- `./fixtures/ancestry.json` (`./test/fixtures/ancestry.json`): portable process-ancestry fixtures.

Companion reference documents:

- [Live-Agent Registry and Lock Protocol](registry.md): `$STATE/agents.json` schema 2, `$STATE/agents.lock` and `$STATE/agents.lock.reclaim` tokens, start-time intervals, liveness sweeps, and `reapRegistry`.
- [Harness Adapters, Hook Dispatch, and Model Resolution](adapters.md): `Event` contract, session and terminal process ancestry, per-harness event mappings, Codex worker rows and root retirement, Codex model resolution, and `relay hook` budgets, guard protocol, and observer protocol.
- [Interaction Messages, Inbox Service, and Question Routes](questions.md): interaction message and entry schemas, 9-state lifecycle, `$STATE/serve.sock` NDJSON protocol, loopback/Tailscale HTTP guard, and the Claude Code and Codex question routes.

## Public interfaces

Type notation documents JavaScript values; no TypeScript toolchain is required at runtime.

```ts
type Diagnostic = { code: string; message: string; agentId?: string };
type Liveness = { status: 'alive' | 'dead' | 'unknown'; reason: string };
type ClockOptions = { deadline?: number; clock?: () => number };
// deadline is absolute performance.now() time, never Unix milliseconds.
type Paths = {
  stateDir: string; agentsPath: string; lockPath: string; reclaimPath: string;
  configDir: string; subscribersPath: string;
};
type ProcessRow = {
  pid: number; ppid: number; comm: string;
  tty: true | string | null; starttime: string | null; state: string | null;
};
type ProcessOps = {
  recordOf(pid: number, options?: ClockOptions): ProcessRow | null;
  ancestors(pid: number, options?: ClockOptions): ProcessRow[];
  handleOf(pid: number, options?: ClockOptions): Handle | null;
  probe(handle: Handle | null, options?: ClockOptions): Liveness;
  executableOf(pid: number, options?: ClockOptions): string;
  argvOf(pid: number, options?: ClockOptions): string[];
};
type Adapter = {
  events: Readonly<Record<string, { kind: Event['kind']; level: State | null }>>;
  stateForEvent(nativeEvent: string): State | null;
  reduceState(level: State | null, previous?: State | null,
    context?: { background?: { agents: number; other: number } }): State | null;
  backgroundOf?(data: Record<string, unknown>, nativeEvent: string): { agents: number; other: number } | null | undefined; // Claude Code only
  resolveSessionPid(options?: { startPid?: number; ancestors?: (pid: number) => ProcessRow[];
    executableOf?: (pid: number) => string; argvOf?: (pid: number) => string[] }): number | null;
  resolveTerminalPid(options?: { startPid?: number; ancestors?: (pid: number) => ProcessRow[];
    executableOf?: (pid: number) => string; argvOf?: (pid: number) => string[] }): number | null;
};
type ReadOptions = ClockOptions & { paths?: Paths; processOps?: ProcessOps };
type MutationOptions = ReadOptions & {
  now?: () => number; uuid?: () => string;
  gitContext?: (cwd: string, options: ClockOptions) => Promise<{
    repoRoot: string | null; remote: string | null;
  }>;
  resolveSessionPid?: (adapter: Adapter) => number | null;
};
type MutationResult = {
  snapshot: Snapshot | null; changed: boolean; reaped: string[];
  diagnostics: Diagnostic[];
};
type Listing = {
  snapshot: Snapshot | null;
  liveness: Record<string, Liveness>;
};

// R1 named root exports (src/index.js):
STATES: readonly State[];
paths(env?: Record<string, string | undefined>): Paths;
adapterFor(harness: Harness): Adapter;
normalizeEvent(harness: Harness, nativeEvent: string, raw: string | Buffer): Event;
readNativeInput(stream: NodeJS.ReadableStream, options?: ClockOptions): Promise<Buffer>;
createProcessOps(options?: {
  platform?: 'linux' | 'darwin';
  readText?: (path: string) => string;
  runPs?: (args: string[], options: ClockOptions) => string;
  kill?: (pid: number, signal: number) => void;
  hostname?: () => string;
}): ProcessOps;
readSnapshot(options?: ReadOptions): Promise<Snapshot | null>;
listAgents(options?: ReadOptions): Promise<Listing>;
applyEvent(event: Event, options?: MutationOptions): Promise<MutationResult>;
reapRegistry(options?: ReadOptions): Promise<MutationResult>;

// R2 named root exports (src/index.js):
CONTEXT_LIMIT: 10000;
parseReply(output: string, options?: { limit?: number }): Reply;
validateSubscribers(value: unknown): SubscriberConfig;
loadSubscribers(paths: Paths): Promise<SubscriberConfig>;
matchSubscribers(config: SubscriberConfig, event: Event): Subscriber[];
budgetFor(options: { harness?: Harness; nativeEvent?: string; outerMs?: number }): Budget;
checkBudget(config: SubscriberConfig, budget: Budget, scope: { harness?: Harness; kind: string }): Subscriber[];
dispatchHook(request: { harness: Harness; nativeEvent: string; input: NodeJS.ReadableStream; outerMs?: number }, deps?): Promise<HookResult>;
reconcile(request?: { outerMs?: number }, deps?): Promise<{ result: MutationResult; diagnostics: string[] }>;
```

Defaults resolve once at operation entry: `paths` from environment, fresh process provider, `clock = performance.now`, `now = Date.now`, `uuid = randomUUID`. Registry operations use `deadline = clock() + 12000`. `deadline` is monotonic absolute time, not Unix milliseconds; nested work shares it. Process and Git subprocesses use at most two seconds and remaining deadline, bounded output, and `SIGKILL` on timeout. `readNativeInput` accepts at most 4 MiB and requires EOF within `min(caller deadline, clock() + 5000)`, with fatal UTF-8 decoding, rejecting partial input on errors or expiry. OS stalls can exceed userspace bounds; no timeout releases another live writer's lock or interrupts an active transaction callback.

## CLI

Registry, hook dispatch, installation, and model commands:

- `relay list`
- `relay reap [--outer-ms N]`
- `relay hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT` (`NAME` may be `agy`; `install` does not accept `agy`)
- `relay install --harness NAME --subscribers FILE (--target FILE | --config-dir DIR) [--evidence FILE] [--retire familiar] [--with ask] [--node PATH] [--apply --artifact FILE]`
- `relay rollback --artifact FILE`
- `relay model --harness codex|agy`
- `relay --help`, `relay help [<command>]`, `relay <command> --help`, and `relay --version`

Interaction commands (backed by `relay serve` over `$STATE/serve.sock`; see [questions.md](questions.md)):

| Command | Contract |
| --- | --- |
| `relay serve` | Foreground service; `SIGTERM`/`SIGINT` drains active work and exits. `serve.sock` must fit the platform's Unix socket path limit (107 UTF-8 bytes on Linux, 103 on Darwin); serve (before its lock or inbox) and every client (before connecting) refuse a longer path with `INVALID_CONFIG`, naming the path, its length, and the remedy (a shorter `RELAY_STATE_DIR` or `XDG_STATE_HOME`). Other platforms refuse with `INVALID_CONFIG`, since no limit is known for them. |
| `relay ask --harness claude-code [--handback] PreToolUse\|PostToolUse` | Hook route; strict option order; exits `0` on runtime failures (stdout is the hook reply; runtime errors diagnose on stderr and pass through) and exits `2` on argv usage errors. |
| `relay inbox list [--since SEQ]` | List current entries plus terminal entries changed after the sequence. |
| `relay inbox ask --file PATH` | Validate and post one detached question envelope from a UTF-8 JSON file, print the saved entry, and exit without waiting. |
| `relay inbox take ID` | Consume a detached answered/undeliverable question; repeated take returns its consumed entry unchanged. |
| `relay inbox show ID` | Full entry and history. |
| `relay inbox answer ID ITEM=VALUE... [--surface cli\|terminal]` | Supply every item's value (`ITEM=true`/`false`, `ITEM=o1`, `ITEM=o1,o2`, `ITEM=other:text`, `ITEM=text:text`). Surface defaults to `cli`; `terminal` records an answer relayed through the session. |
| `relay inbox answer ID --decline [--surface cli\|terminal]` | Decline, with no values. |
| `relay inbox defer ID` / `relay inbox withdraw ID [--reason user\|asker]` | Defer to desktop/native UI, or withdraw (default `user`). Asker withdrawal uses the question's agent as sender and the user as recipient. |
| `relay presence [here\|away]` | Read/set durable presence; `here` is the initial default. |
| `relay install --harness claude-code --subscribers FILE --target FILE --evidence FILE --with ask [--apply --artifact FILE]` | Plan/apply the evidence-gated route. Every Claude install reconciles the route: without `--with ask` it removes relay's own `ask` entries. |

`--json` and `--pretty` are global and mutually exclusive; `RELAY_FORMAT` sets the default (`hook` and `ask` ignore it because they print only the harness reply), and `install` is JSON by default (its output is the installation artifact). Each hook command `install` writes runs `relay.js` through the installer's own Node (`process.execPath`, absolute and quoted) so GUI-launched harnesses under macOS `launchd` (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`) find Node without `#!/usr/bin/env node`. `--node PATH` (Claude Code and Codex only) writes that Node path instead, as given and unresolved; it must be an absolute path to an executable file meeting `engines.node` (`>=22`), or `install` exits `2`. When the Node or `relay` path lies inside a version-specific directory (`nvm`, `n`, `fnm`, `nodenv`, `Volta`, `asdf`, `mise`, or Homebrew `Cellar`), a successful `install --apply` prints one `relay: warning: …` line per path on stderr.

`list` emits one JSON `Listing` under `--json`, and otherwise one line per agent: `<id> <harness> <state> <scope>`, followed by ` root=<root>` on a row that records a root (a Codex worker). `reap` prints `{"reaped":N}` under `--json` and `Reaped N agent(s).` otherwise. `rollback` prints nothing on success in either mode. Diagnostics go to stderr. On runtime failure any CLI command (except `relay ask` runtime pass-through and `agy` hook failure overrides; see [adapters.md](adapters.md#failure-modes)) exits `1` with one stderr envelope whose `kind` is `<command>_failed`:

```json
{"error":{"kind":"list_failed","detail":"CORRUPT_STATE: cannot read registry JSON"}}
```

or, outside `--json`, `relay: <detail>` on stderr. A CLI usage error (an unknown command, `relay inbox` alone without a subcommand, or a missing or invalid argument) exits `2` with one line on stderr naming the problem. The CLI exits explicitly once its reply is flushed so a filesystem operation past the deadline is abandoned.

The extracted OpenCode plugin (`relay/opencode`) is installed by `relay install --harness opencode --config-dir DIR`; it has no direct-store bypass or fallback. Its child path is relay's own CLI with `shell: false`, inherited environment, 64 KiB stderr cap, and 5 s lifetime, preserving permission output and awaiting `dispose` last.

Local tarball smoke tests cover package exports, portable JSON fixtures, the sole OpenCode plugin export, the installed CLI, the packaged interaction schema (`schemas/interaction/message.schema.json`), and the shipped operator runbooks ([`inbox-service.md`](runbooks/inbox-service.md) and [`registry-lock-repair.md`](runbooks/registry-lock-repair.md)). Contributor release and probe procedures live in the repository at `docs/runbooks/release.md` and `docs/runbooks/answer-route-probes.md`.

## Error codes

Errors are ordinary `Error` instances carrying `code` and optional internal `cause` (causes may retain OS errors internally but are not serialized into diagnostics).

Storage, process, lock, dispatch, install, and model error codes:

- `INVALID_INPUT`, `INPUT_TOO_LARGE`, `INPUT_TIMEOUT`, `UNSUPPORTED_EVENT`, `UNSUPPORTED_HARNESS`
- `INVALID_SCHEMA`, `CORRUPT_STATE`, `REGISTRY_SUPERSEDED` (`REGISTRY_SUPERSEDED` also appears as a diagnostic when a mutation replaces a schema-1 registry)
- `PROCESS_UNREADABLE`, `PROCESS_UNAVAILABLE`, `DEADLINE_EXCEEDED`
- `LOCK_TIMEOUT`, `LOCK_IDENTITY_UNKNOWN`, `LOCK_REPAIR_REQUIRED`, `LOCK_CLEANUP_FAILED`, `LOCK_OWNERSHIP_LOST` (see [`registry-lock-repair.md`](runbooks/registry-lock-repair.md))
- `IO_ERROR`, `GIT_ERROR`, `USAGE`
- `INVALID_ARTIFACT` (an install artifact fails validation, or a rollback artifact file is not valid JSON; the message names the file), `TARGET_DRIFT` (an install or rollback target holds neither the artifact's before nor after image, or is absent where the operation expected an image; the message names the path, says which, and names the image the operation expected), `UNSAFE_TARGET` (a target is a symlink or not a regular file)
- `INVALID_REPLY`, `UNSUPPORTED_REPLY`, `INVALID_CONFIG`, `INVALID_EVIDENCE`, `UNSUPPORTED_BINDING`, `GUARD_FAILED`
- `BACKGROUND_UNREADABLE` (appears only as a diagnostic on Claude Code `Stop`, never as a thrown error)
- `INVALID_ROLLOUT`, `INVALID_RECORD`, `UNSUPPORTED_RUNTIME` (agy model resolution requires SQLite support in the running Node)

Interaction error codes (`relay serve`, `relay ask`, `relay inbox`, `relay presence`; see [questions.md](questions.md#failure-modes)):

| Codes | Meaning |
| --- | --- |
| `ALREADY_ANSWERED`, `ANSWERED` | A saved answer won; it is retained with the response. |
| `WITHDRAWN`, `EXPIRED`, `RELEASED`, `UNDELIVERABLE` | The requested lifecycle action cannot run in that state. |
| `STALE`, `INVALID_ANSWER`, `LOCAL_ONLY` | Revision mismatch, invalid item values, or remote authorization answer. |
| `NOT_WAITER`, `NOT_ANSWERED`, `NOT_HANDED`, `NOT_SUPERSEDABLE` | Route ownership or transition precondition failed. |
| `ID_CONFLICT`, `NOT_FOUND`, `NOT_A_QUESTION` | Conflicting message identity, missing entry/native call, or wrong entry kind. |
| `INVALID_MESSAGE`, `INVALID_INPUT`, `INVALID_REQUEST`, `UNKNOWN_OP` | Invalid message, native input/presence/cursor, socket frame, or operation. |
| `SERVE_RUNNING`, `SERVE_UNAVAILABLE`, `STORE_FAILED` | Existing live service, unavailable socket, or failed durable write requiring restart. |
| `INVALID_CONFIG`, `INVALID_ENTRY`, `HARNESS_UNAVAILABLE`, `UNSUPPORTED_ROUTE`, `UNEXPECTED_STATE` | Invalid configuration (including a `serve.sock` path over the platform limit) or durable entry, failed harness version probe, or unsupported route/state. |
| `FORBIDDEN`, `UNSUPPORTED_MEDIA`, `TOO_LARGE`, `INTERNAL`, `UNAVAILABLE` | HTTP guard, media/body limit, internal failure, or shutdown. |
