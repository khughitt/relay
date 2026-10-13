# Interaction inbox service

`relay serve` owns the durable inbox and private local socket. HTTP is optional and
binds only `127.0.0.1`; relay ships no phone client. The Claude terminal route has
passing capability evidence for 2.1.296, but Task 14's user-present tailnet end-to-end
acceptance is still pending. This runbook describes operation; the package installs
no unit, tailnet service or live hook.

## User unit

Put this unit in `%h/.config/systemd/user/relay-serve.service`, replacing the checkout,
host, tailnet and login placeholders. `%h` is expanded by systemd; the unit's PATH
must resolve Node >=22 (the example uses `/usr/bin/env node`).

```ini
[Unit]
Description=relay serve: interaction inbox

[Service]
ExecStart=/usr/bin/env node %h/<relay checkout>/bin/relay.js serve
Environment=RELAY_HTTP_PORT=3340
Environment=RELAY_SERVE_HOST=<host>.<tailnet>.ts.net
Environment=RELAY_SERVE_LOGIN=<tailscale login>
Restart=on-failure

[Install]
WantedBy=default.target
```

Use the same `RELAY_STATE_DIR` in the unit and CLI when overriding the default
XDG state path. The chosen state directory must be owned by you and mode 0700;
existing unsafe directories are rejected, never silently chmodded. Inbox files
and `serve.sock` are 0600. To operate the unit:

```sh
systemctl --user daemon-reload
systemctl --user enable --now relay-serve.service
journalctl --user -u relay-serve.service
```

SIGTERM/SIGINT stops new work, drains active requests/writes and releases the service
lock. To stop it, use `systemctl --user stop relay-serve.service`; disable it with
`systemctl --user disable relay-serve.service`. A user manager must remain running
for phone access when no desktop session is active.

## Phone access

The host and phone must be in the private tailnet, with MagicDNS and HTTPS
certificates enabled. Expose only the loopback HTTP listener with Tailscale Serve:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3340
```

Remove that mapping with:

```sh
tailscale serve --https=443 off
```

On any HTTPS port other than 443, `RELAY_SERVE_HOST` includes it, for example
`<host>.<tailnet>.ts.net:8443`. Tailscale passes the incoming Host through, and the
phone's Origin is then `https://<host>.<tailnet>.ts.net:8443`. Host, login and Origin
comparisons are exact, including case and port. Any `X-Forwarded-*` header or
Tailscale identity/Funnel header marks a request as proxied; the configured Host
and login must match and Funnel is refused. POST and PUT require a matching Origin,
`application/json`, and at most 64 KiB of body bytes. See the
[HTTP contract](../api.md#http-protocol-and-guard) for routes and errors.

Set `RELAY_CLIENT_DIR` to an absolute static-client directory if a client is supplied
separately; its files use the same guarded origin. Without it, the API still runs.
A sleeping host serves nothing. Clients should show their last sync and retry with
the same `answerId` after reconnecting; expiry runs before a queued answer is applied.

## Installing the question route

Run the [answer route probes](answer-route-probes.md) first, including after a Claude
Code upgrade. The recorded five passing rows are for 2.1.296; an unknown/new version
requires fresh evidence. Terminal-answer and deny-stops gate PreToolUse, receipt gates
PostToolUse, release enables handback, and under-denial records behavior only.

Plan against an explicit settings target and private subscriber file, inspect the
returned JSON artifact, then apply it with an explicit artifact path:

```sh
relay install --harness claude-code --subscribers /path/to/subscribers.json --target /path/to/settings.json --evidence docs/evidence/claude-code-answer-routes.json --with ask > /path/to/ask-install-plan.json
relay install --harness claude-code --subscribers /path/to/subscribers.json --target /path/to/settings.json --evidence docs/evidence/claude-code-answer-routes.json --with ask --apply --artifact /path/to/ask-install-applied.json
```

`--evidence` names one record for the installed Claude Code version. The committed
route record holds only the route rows (`probes: []`), which is enough while no guard
subscriber matches PreToolUse. With a guard subscriber, the same record must also hold
the passed dispatch probes for that version (`refuse` and `context` on PreToolUse at the
installed budget, from the guard probe's evidence record). Combine the two records,
refusing a harness or version mismatch, and pass the result as `--evidence`:

```sh
jq -s 'if .[0].harness != .[1].harness or .[0].version != .[1].version
  then error("evidence records differ in harness or version")
  else .[0] + {routes: .[1].routes} end' \
  /path/to/dispatch-evidence.json docs/evidence/claude-code-answer-routes.json > /path/to/evidence.json
```

Every `relay install --harness claude-code` reconciles the route. Without `--with ask`
the plan removes the relay `ask` entries installed before, and keeps the dispatch hooks.
After a Claude Code upgrade, `--with ask` refuses until fresh route evidence is
recorded; run the install without it to take the unprobed route out in the meantime.

Run these from the checkout so the evidence path resolves. Apply with no live harness
session after artifact inspection. The subscriber file must be a 0600 regular file
in a privately owned 0700 directory. The route is supported only for Claude's
interactive terminal in v1. Installed hook commands use the installer's Node path;
removing that runtime requires reinstalling the hooks. This route records and
delivers decisions; it grants no authorization.

Rollback uses the applied artifact, preserving unrelated settings:

```sh
relay rollback --artifact /path/to/ask-install-applied.json
```

Rollback restores only bytes matching the artifact's `after`; an already restored
`before` is skipped, and other bytes refuse. See the
[hook install and recovery runbook](hook-install-rollback.md).

## Presence and desk commands

Before leaving the desk, run `relay presence away`; on return, run
`relay presence here`. Presence is persisted; the initial default is here. Here
passes new questions to the native UI. Existing pending questions stay pending:
use `relay inbox defer ID` to return one to the native UI when handback is available.
Away routes new questions into the inbox.

The phone can read `GET /v1/presence` and set `PUT /v1/presence` with JSON
`{"mode":"away"}` or `{"mode":"here"}` and the guard's matching Origin.
`relay inbox list`, `relay inbox show ID`, `relay inbox answer ID ITEM=VALUE...`,
`relay inbox defer ID` and `relay inbox withdraw ID` provide the desk surface;
`relay inbox` alone is a usage error. `--since SEQ` is an integer durable sequence,
not a date. `--json` preserves machine states; human output distinguishes “answer
saved”, “handed to the agent”, “the agent received it” and “handed, receipt not
confirmed”. Only consumed means confirmed receipt. If answer, defer or withdraw
loses to a saved answer, exit 1 shows the winner's values, surface and save time;
JSON preserves the usual error kind/detail and adds the saved entry at `error.entry`.

## Recovery

`inbox/rejected/` holds entries that failed validation or supersession reconciliation.
The service reports their filenames and reasons and never cleans this directory
automatically. Preserve them for diagnosis; do not move them back without resolving
the rejection. Terminal entries older than 30 days are pruned separately, except
predecessors referenced by nonterminal replacements.

`STORE_FAILED` stops the service after a failed durable write; restart reconciles
what reached disk before accepting clients. Startup syncs every directory on the
configured absolute state path that can hold a link relay created, including
recursively created directories and links left by interrupted initialization: the
state directory, the inbox, and each ancestor whose child on the path is owned by the
service's uid and which that uid may write. An ancestor relay could not have written
into, such as another user's 0711 directory, is never opened. A sync failure refuses
startup.
Every acknowledged write is durable.
Preserve `inbox/seq`, entries, rejected files and presence during recovery; never
reset the counter or treat a published answer as rolled back.

`SERVE_RUNNING` means a live service holds `serve.lock`; use that instance or stop
its unit rather than deleting its lock. A stale `serve.lock` after a crash is reclaimed
on the next start only when qualified process evidence proves its holder dead. Age
alone is not proof; unknown holders remain protected.

For `LOCK_REPAIR_REQUIRED`, follow the quiescence, ownership, preservation and exact-file
rules in [registry lock repair](registry-lock-repair.md). That runbook's script targets
`agents.lock` and `agents.lock.reclaim`; a service-lock incident instead concerns
`serve.lock` and `serve.lock.reclaim` under the same `paths().stateDir`. Stop all relay
writers first, diagnose and preserve the tokens, and remove only the diagnosed pair
under that procedure. Preserve the registry and inbox data. Never sweep control or
temporary files with a wildcard. Restart the unit and inspect its journal before
restoring hook invocations.
