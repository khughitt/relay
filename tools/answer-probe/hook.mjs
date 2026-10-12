#!/usr/bin/env node
// Probe hook for AskUserQuestion. argv: MODE SECONDS LOGFILE. Appends one JSON line per
// event to LOGFILE; never touches anything else.
import { appendFileSync, readFileSync } from 'node:fs';
const [mode, seconds, log] = process.argv.slice(2);
const at = () => Date.now();
const note = (event, extra = {}) => appendFileSync(log, `${JSON.stringify({ at: at(), pid: process.pid, mode, event, ...extra })}\n`, { mode: 0o600 });
const input = JSON.parse(readFileSync(0, 'utf8'));
note('fired', { hook: input.hook_event_name, toolUseId: input.tool_use_id, toolInput: input.tool_input, toolResponse: input.tool_response });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { note('signal', { signal }); process.exit(143); });
const out = (value) => { note('return', { value }); process.stdout.write(`${JSON.stringify(value)}\n`); process.exit(0); };
const pre = (decision, extra) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, ...extra } });
const wait = (s) => new Promise((resolve) => setTimeout(resolve, Number(s) * 1000));
if (mode === 'post-log') process.exit(0);
await wait(seconds);
if (mode === 'answer') out(pre('allow', { updatedInput: { ...input.tool_input, answers: Object.fromEntries(input.tool_input.questions.map((q) => [q.question, 'Square'])) } }));
if (mode === 'deny') out(pre('deny', { permissionDecisionReason: 'question withdrawn by the user; do not wait for an answer' }));
if (mode === 'release') { note('return', { value: null }); process.exit(0); }
throw new Error(`unknown mode ${mode}`);
