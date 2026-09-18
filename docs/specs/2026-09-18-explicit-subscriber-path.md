# Explicit subscriber configuration in installed hook entries

Status: draft for review, 2026-09-18.
Task: `relay-a1510a`.
Parent design: ops `docs/specs/2026-09-16-relay-design.md` (approved after `d7e2c33`);
installers plan `docs/plans/2026-09-17-installers.md`.
Scope: how an installed hook entry names relay's subscriber configuration, and what
an absent configured file means. Reply encoding, budgets, ownership rules for other
hook shapes and the registry are unchanged.

## Finding

The 2026-09-18 ops relay-guard probe (ops `docs/runbooks/relay-guard-probes.md`)
recorded codex-cli 0.155.0 delivering `PreToolUse` with `tool_name: "Bash"` and
`tool_input.command` to relay, yet the live harness neither refused the attributed
commit nor echoed the context nonce, while offline replay produced both replies.

The encoder is not at fault. Checked against the Codex source at tag
`rust-v0.155.0` (`codex-rs/hooks/src/events/pre_tool_use.rs`,
`codex-rs/hooks/src/engine/output_parser.rs`): exit 2 with a non-empty stderr is a
block with that reason; exit 0 with `hookSpecificOutput.permissionDecision: "deny"`
and a non-empty `permissionDecisionReason` is a block; `additionalContext` on exit 0
is recorded as a developer message for the model. Relay writes exactly these.
Replaying the *recorded* live payloads (not the probe's synthetic ones) through
`relay hook --harness codex` offline yields the refusal (exit 2) and the context
(exit 0) as documented.

Live, relay ran with no subscribers. Evidence:

* Relay's disposable registry holds the live Codex session ids, including the deny
  session, and relay publishes the registry only after every guard allowed.
* The ops guard logs every block to `attribution-blocks.log`; the log has entries for
  the Codex preflight replay and the live Claude deny, and none for the live Codex
  deny.
* Codex spawns command hooks as `$SHELL -lc '<command>'`
  (`codex-rs/hooks/src/engine/command_runner.rs`, `default_shell_command`), a login
  zsh on this host. `~/.zshenv` exports `XDG_CONFIG_HOME="$HOME/.config"`
  unconditionally, so the probe's `XDG_CONFIG_HOME=<probe>/xdg` was replaced before
  relay started: `XDG_CONFIG_HOME=/x zsh -lc 'echo $XDG_CONFIG_HOME'` prints
  `/home/<user>/.config`. Relay looked for `~/.config/relay/subscribers.json`, found
  nothing, and `loadSubscribers` returned an empty list. No guard ran, no context was
  produced, the registry was published (`RELAY_STATE_DIR` is not touched by the
  shell startup), and the reply was an empty allow.

The Claude probe passed under the same environment, so Claude Code's hook shell did
not rewrite it. The failure is environmental, but it exposes a contract problem: a configured guard silently became no guard because relay resolves
its policy configuration from the hook process environment, which the harness's
shell startup may rewrite, and treats the absence of that file as "no subscribers".

## Decision

1. **The installed hook entry names the subscriber file.** `relay hook` accepts
   `--subscribers FILE` (an absolute path) and every installer-written entry carries
   it: `'<relay>' hook --harness H --outer-ms N --subscribers '<file>' EVENT`. The
   installer already requires `--subscribers FILE`, validates it, and plans budgets
   from it, so the path is known when the entry is written; the entry records the
   resolved absolute path of that file. The hook process environment no longer
   decides which policy runs.
2. **An explicitly named file must exist.** With `--subscribers`, an absent file is
   `INVALID_CONFIG`, the same class as an unreadable or malformed one. On
   guard-capable events that is a native refusal (fail closed, as the parent design
   requires for configured guards); elsewhere it is a reported error. The installer
   wrote that path; its absence is a broken installation, not an empty policy.
3. **Without the flag, nothing changes.** `relay hook` and `relay reap` without
   `--subscribers` keep resolving `$XDG_CONFIG_HOME/relay/subscribers.json` (else
   `~/.config/relay/subscribers.json`), where an absent file still means no
   subscribers. That remains the documented contract for direct invocation and for
   `reap`, which runs from the operator's own environment rather than a harness hook.

Rejected alternatives:

* *A relay-specific environment variable* (`RELAY_CONFIG_DIR`, like
  `RELAY_STATE_DIR`). It happens to survive this host's `~/.zshenv`, but the entry
  would still depend on whatever the harness's shell startup leaves in the
  environment; the next dotfile line breaks it again, silently.
* *Refusing whenever the default file is absent.* Relay cannot tell an intentionally
  unconfigured host from a lost environment, and it would turn every flagless
  invocation on a fresh machine into a refusal.
* *Fixing only the probe* (for example, rendering a wrapper that re-exports the
  variables). It leaves the silent fallback in place for any future environment
  drift and makes the probe prove a shape the installer does not write.

## Contract changes

**CLI.** `relay hook --harness NAME [--outer-ms N] [--subscribers FILE] EVENT`, flags
in that order, each at most once, `FILE` absolute. Parsing stays strict: a relative
path, a repeated flag, or a flag after `EVENT` is `USAGE` (exit 1, no refusal, as
today for other usage errors). `--help` text and `docs/api.md` gain the flag.

**Dispatcher.** `dispatchHook` receives `subscribersPath` (absolute or `null`). It
resolves `paths` as before and, when a path is given, overrides `configDir` and
`subscribersPath` with the file's directory and the file. Loading with an explicit
path fails `INVALID_CONFIG` when the file is absent; the existing privacy checks
(0700 directory, 0600 file, owned by the invoking user) apply unchanged.
Configuration errors already refuse on guard-capable events and report on the rest.

**Installer.** `bindingsFor` is unchanged. `planHooks` takes `subscribersPath` and
renders it into every relay entry, shell-quoted like the executable. Ownership
classification recognizes `relay hook --harness H [--outer-ms N] [--subscribers
FILE] EVENT` for either the quoted or unquoted executable form, so an entry from
before this change is still relay-owned and replaced as a whole. The CLI passes the
resolved absolute path of the `--subscribers` argument it already read. `Artifact`
and `Evidence` shapes are unchanged; capability validation is unchanged because the
same validated subscribers plan the budgets.

**Docs.** `docs/api.md` (subscriber configuration, budget source, CLI), `README.md`
("subscribers come only from `~/.config/relay/subscribers.json`"), and
`docs/runbooks/hook-install-rollback.md` (what an installed entry contains).

## Out of scope

* The registry location still comes from `RELAY_STATE_DIR` or the XDG state base.
  A rewritten state base misplaces observation data and is reported as a
  diagnostic; it cannot change a policy decision. Not changed here.
* `relay reap` keeps environment-resolved configuration.
* Codex delivers `additionalContext` as a developer message, not inside the tool
  result. The ops probe's allow prompt asks the model to echo the nonce "if a tool
  result gave you a line"; that wording may under-report delivery on Codex even once
  the context reaches the model. That is an ops probe concern for `ops-88916d`,
  which must also render the installer's current entry shape (`timeout` field from
  `relay-d79dc3`, `--subscribers` from this change) rather than the pre-change one.

## Verification

* Unit: hook parsing accepts the flag in order and rejects relative, repeated, and
  misplaced forms; `dispatchHook` with an explicit absent file refuses on
  `PreToolUse`/`UserPromptSubmit`/`Stop` and reports on `SessionStart`; an explicit
  present file loads regardless of `XDG_CONFIG_HOME`; the flagless default is
  unchanged.
* Installer: generated Claude and Codex documents carry `--subscribers` with the
  quoted resolved path in every relay entry; pre-change relay entries (with and
  without `--outer-ms`) are recognized and replaced; the CLI install writes the
  resolved path.
* Real CLI: `relay hook --harness codex --subscribers <file> PreToolUse` run under
  `zsh -lc` with a foreign `XDG_CONFIG_HOME` still dispatches the configured guard.
  This is the regression the probe missed, reproduced without a harness.
* `just gate` on the development runtime and on Node 22.
* Live proof stays with ops `ops-88916d`: rerun the Codex probe against the
  installer's entry shape and offer only matching proven evidence to
  `relay install --evidence`.
