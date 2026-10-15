---
id: relay-47bf70
title: Refuse an over-long relay serve socket path with an actionable error
status: todo
priority: 2
size: s
complexity: low
process: direct
created: 2026-10-14T10:24:23Z
updated: 2026-10-15T22:28:14Z
depends: []
tags: [feedback, friction, "from:trans"]
agent: codex
---

Reported (feedback, from trans, 2026-10-14): "Service startup does not validate the Unix socket pathname byte limit; a deep private state directory fails with opaque EINVAL instead of an actionable path-length error." transponder hit it on the first launch of its phone-inbox acceptance and now reaches the state directory through a short private alias (transponder docs/reports/2026-10-phone-inbox-acceptance.md, "Setup friction").

Why: the socket is <stateDir>/serve.sock (src/serve/serve.js:18, servePaths), and nothing checks its length. Reproduced at scoping on Linux, with net.createServer().listen and net.createConnection, using paths of 104, 107, 108, 109 and 120 bytes:
- Node v26.5.0: up to 108 bytes binds and connects. Past that, listen and connect both fail with a bare EINVAL, which serveSocket rethrows unchanged (src/serve/socket.js:156) and connectSocket reports as SERVE_UNAVAILABLE "relay serve is not running" (src/serve/client.js:10).
- Node v22.23.2, the floor: past 108 bytes, listen succeeds but binds a different file, truncated to 108 bytes, and connect truncates the same way. serveSocket's next step, fs.chmod(socketPath), targets the full path, which does not exist, and its lstat ownership check and fs.rm look at the wrong path too. Two state directories that share a 108-byte prefix would share one socket.
Every consumer takes the path from servePaths: serve (src/serve/serve.js:24), and ask, inbox and presence (bin/relay.js:182, 203, 209).

Done: relay refuses an over-long socket path before any bind or connect, with INVALID_CONFIG naming the path, its byte length, the platform limit, and the remedy (a shorter RELAY_STATE_DIR or XDG_STATE_HOME), on both runtimes, in serve and in every client. The limit is sun_path less its terminating NUL: 107 bytes on Linux and 103 on Darwin (Darwin's is from its sockaddr_un, not probed here). Lengths count UTF-8 bytes, not characters. relay ask keeps its passthrough on a connect failure, now with that error. Tests cover a path at the limit and one byte over, through serve and a client; docs/api.md's serve section and error table name the check.

Where: src/serve/serve.js (servePaths, runServe), src/serve/socket.js (serveSocket), src/serve/client.js (connectSocket), src/routes/ask.js (passthrough), bin/relay.js; test/serve-socket.test.js, test/serve-process.test.js and test/cli-desk.test.js for the existing shapes.

## Notes

- 2026-10-15T22:28:14Z (main): scope: scoped; reproduced on Linux (node v26.5.0: EINVAL past 108 bytes; v22.23.2: silently binds a 108-byte truncation, so serveSocket's chmod and lstat target a missing path), with every socket consumer traced to servePaths (main d7ac402); retitled to the outcome, kept the report verbatim; todo P2 s/low/direct
