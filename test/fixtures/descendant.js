#!/usr/bin/env node
// Process-tree fixtures for containment tests. argv[2] selects the behavior; a MARKER argument
// lets the test find every process this fixture started. Grandchildren inherit stdout/stderr, so
// they hold the subscriber's pipes open after the subscriber itself exits.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
const self = new URL(import.meta.url).pathname;
// unref: the fixture itself may exit while its grandchild lives on.
const grandchild = (marker) => spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', marker], { stdio: 'inherit' }).unref();
const hang = () => setInterval(() => {}, 60000);
const drain = async () => { for await (const _ of process.stdin) { /* read to EOF */ } };

switch (mode) {
  case 'allow': await drain(); process.stdout.write('{"decision":"allow"}'); break;
  case 'grandchild': await drain(); grandchild(rest[0]); process.stdout.write('{"decision":"allow"}'); break;
  case 'hang': hang(); break;
  case 'hang-grandchild': grandchild(rest[0]); hang(); break;
  case 'overflow': process.stdout.write('x'.repeat(70000)); hang(); break;
  case 'fast': break;
  // A descendant that leaves the subscriber's group (setsid) but keeps its pipes: unsupported, and
  // relay must still finish within its cleanup reserve and report the escape.
  case 'escape': spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', rest[0]], { stdio: 'inherit', detached: true }).unref(); process.stdout.write('{"decision":"allow"}'); break;
  case 'escape-hang': spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', rest[0]], { stdio: 'inherit', detached: true }).unref(); hang(); break;
  case 'dispatcher': {
    // Acts as a dispatcher: starts a supervisor, admits one long-running subscriber with a
    // grandchild, and dies by SIGKILL either right after sending the run or once it is admitted.
    const [recordDir, marker, when] = rest;
    const { createChildSupervisor } = await import(new URL('../../src/child-supervisor.js', import.meta.url).href);
    const supervisor = await createChildSupervisor({ deadline: performance.now() + 30000, sessionHandle: null, recordDir });
    process.stdout.write(`${JSON.stringify({ ready: true, nonce: supervisor.nonce })}\n`);
    void supervisor.runChild([process.execPath, self, 'hang-grandchild', marker], '', { timeoutMs: 20000, deadline: performance.now() + 25000, env: { PATH: process.env.PATH }, cwd: '/' });
    if (when === 'at-send') process.kill(process.pid, 'SIGKILL');
    const path = `${recordDir}/${supervisor.nonce}.json`;
    const poll = setInterval(() => {
      try { if (JSON.parse(readFileSync(path, 'utf8')).phase === 'active') { clearInterval(poll); process.kill(process.pid, 'SIGKILL'); } } catch {}
    }, 5);
    break;
  }
  default: process.exit(9);
}
