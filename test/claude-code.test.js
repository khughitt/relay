import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentPid, reduceState } from '../src/adapters/claude-code.js';
import { STATES } from '../src/protocol.js';
test('interactive session: the agent is the immediate parent, one level up', () => {
  // docs/spikes/2026-07-11-hook-environment.md, finding C, "interactive" shape.
  const chain = [
    { pid: 500, comm: 'node', ppid: 450, tty: null },
    { pid: 450, comm: 'claude', ppid: 200, tty: true },
    { pid: 200, comm: 'zsh', ppid: 100, tty: true },
    { pid: 100, comm: 'kitty', ppid: 1, tty: null },
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 500, ancestors: () => chain }), 450);
});

test('background/daemon-hosted session: a claude process with no tty (the daemon) is skipped for the real terminal-owning agent four levels up', () => {
  // docs/spikes/2026-07-11-hook-environment.md, finding C, "background" shape.
  // comm === 'claude' alone would wrongly stop at pid 300 (the daemon, no tty)
  // in 370 of 1507 real samples.
  const chain = [
    { pid: 500, comm: 'node', ppid: 450, tty: null },
    { pid: 450, comm: '2.1.207', ppid: 400, tty: null },       // claude bg-pty-host
    { pid: 400, comm: '2.1.207', ppid: 300, tty: null },
    { pid: 300, comm: 'claude', ppid: 200, tty: null },        // claude daemon run — comm matches, no tty
    { pid: 200, comm: 'claude', ppid: 100, tty: true },        // the real, terminal-attached agent
    { pid: 100, comm: 'zsh', ppid: 1, tty: true },
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 500, ancestors: () => chain }), 200);
});

test('a claude process with no terminal anywhere in the chain is a null result, not a silent daemon match', () => {
  const chain = [
    { pid: 500, comm: 'node', ppid: 300, tty: null },
    { pid: 300, comm: 'claude', ppid: 1, tty: null },   // daemon only — must not match
  ];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 500, ancestors: () => chain }), null);
});

test('no agent in the ancestor chain is a null result — a record keyed to a dead pid is worse than none', () => {
  const chain = [{ pid: 500, comm: 'node', ppid: 1, tty: null }];
  assert.equal(resolveAgentPid({ platform: 'linux', startPid: 500, ancestors: () => chain }), null);
});

test('the Darwin chain measured on a real Mac resolves claude, not the hook or its shell', () => {
  const chain = [
    { pid: 37708, ppid: 37707, comm: 'node', tty: null },
    { pid: 37707, ppid: 37609, comm: 'sh', tty: null },
    { pid: 37609, ppid: 35113, comm: 'claude', tty: 'ttys000' },
    { pid: 35113, ppid: 35112, comm: '-zsh', tty: 'ttys000' },
  ];
  assert.equal(
    resolveAgentPid({ startPid: 37708, ancestors: () => chain }),
    37609,
  );
});
