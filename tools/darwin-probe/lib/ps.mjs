import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

export const ROW = 'pid=,ppid=,tty=,lstart=,comm=';
// Relay spawns /bin/ps with the caller's environment plus LC_ALL=C; the probe's environment
// has no COLUMNS, so the plain variant is what relay reads in a hook whose harness does not
// export COLUMNS. D0 records whether the user's shell exports it.
export function ps(args, { columns = null } = {}) {
  const env = { ...process.env, LC_ALL: 'C' };
  delete env.COLUMNS;
  if (columns) env.COLUMNS = String(columns);
  const r = spawnSync('/bin/ps', args, { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { exit: r.status, stdout: r.stdout ?? '' };
}
const pidOf = (line) => Number(/^\s*(\d+)/.exec(line)?.[1]);
export const rowFor = (text, pid) => text.split('\n').find((line) => pidOf(line) === pid)?.trim() ?? null;
export function compareCapture(relay, ww) {
  const both = relay !== null && ww !== null;
  return { relay_len: relay?.length ?? null, ww_len: ww?.length ?? null, truncated: both && relay !== ww, relay_is_prefix: both && ww.startsWith(relay) };
}
export function capture(pid, label) {
  const forms = { row: ['-axo', ROW], comm: ['-p', String(pid), '-o', 'comm='], args: ['-p', String(pid), '-o', 'args='] };
  const out = {};
  for (const [form, args] of Object.entries(forms)) {
    const pick = (text) => (form === 'row' ? rowFor(text, pid) : text.trim() || null);
    const relay = pick(ps(args).stdout), columns = pick(ps(args, { columns: 500 }).stdout), ww = pick(ps(['-ww', ...args]).stdout);
    out[form] = { relay, columns, ww, ...compareCapture(relay, ww) };
  }
  // relay's own capture is the pid,ppid,tty,lstart,comm row; it reads args only for argv[1],
  // to recognize a role word, so only row/comm truncation can hide anything relay reads. A
  // truncated args form is recorded (args_truncated) but does not gate `truncated`.
  return { pid, label, forms: out, truncated: out.row.truncated || out.comm.truncated, args_truncated: out.args.truncated };
}
// D9 keeps only what recognition needs, so no argument text of a user's session leaves the
// Mac; D7 applies the same strip to every hook invocation's captures for the same reason.
export function stripCapture(c) {
  const { relay, columns, ww, ...facts } = c.forms.args ?? {};
  return { ...c, forms: { ...c.forms, args: facts } };
}
export function tableCounts() {
  const plain = ps(['-axo', ROW]).stdout.trimEnd().split('\n');
  const wide = new Map(ps(['-ww', '-axo', ROW]).stdout.trimEnd().split('\n').map((l) => [pidOf(l), l.trim()]));
  let over = 0, truncated = 0;
  for (const line of plain) { const w = wide.get(pidOf(line)); if (!w) continue; if (w.length >= 80) over++; if (w !== line.trim()) truncated++; }
  return { rows: plain.length, over_cut: over, truncated };
}
const VERSION = /^\d+\.\d+\.\d+$/;
export function sampleHarnessRows(names) {
  const rows = ps(['-ww', '-axo', ROW]).stdout.trimEnd().split('\n');
  return rows.map((line) => { const m = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+(.+)$/.exec(line); return m && { pid: +m[1], ppid: +m[2], row_ww: line.trim(), comm_ww: m[3] }; })
    .filter((r) => r && (names.includes(basename(r.comm_ww)) || VERSION.test(basename(r.comm_ww))));
}
