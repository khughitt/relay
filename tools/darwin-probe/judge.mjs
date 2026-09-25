// Pure verdicts over the results contract (docs/plans/2026-09-25-darwin-probe.md). Every rule
// reads recorded observations only; nothing here touches the filesystem or a process.
export const RELEASE = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D8'];
const SESSIONEND_BUDGET_MS = 3000;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const COMM_KINDS = { path: 'the executable path', argv0: 'argv[0]', basename: 'the executable file name' };
const result = (ok, detail, findings = []) => ({ verdict: ok ? 'pass' : 'fail', detail, findings });

const rules = {
  D0(o) {
    const findings = [];
    if (o.hosts.start.HostName === null) findings.push('HostName is not set: the host name can change with the network (spec item 4)');
    if (o.hosts.start.os !== o.hosts.end.os) findings.push('host changed during the run');
    if (o.columns_exported) findings.push('COLUMNS is exported in the user environment');
    const expected = ['macos', 'node22', 'clt', 'python311'];
    if (expected.some((k) => typeof o.prerequisites[k] !== 'boolean')) throw new Error('malformed prerequisites');
    const missing = Object.entries(o.prerequisites).filter(([k, v]) => !v && !(k === 'macos' && o.platform !== 'darwin')).map(([k]) => k);
    return result(missing.length === 0, missing.length ? `missing prerequisites: ${missing.join(', ')}` : 'environment recorded', findings);
  },
  D1(o) {
    const bad = [['install', o.install.exit], ['help', o.help.exit], ['list', o.list.exit]].filter(([, e]) => e !== 0).map(([n]) => n)
      .concat(Object.entries({ ...o.exports, ...o.subpaths }).filter(([, v]) => v !== true).map(([n]) => `export ${n}`));
    return result(bad.length === 0 && Object.keys(o.exports).length > 0, bad.length ? `failed: ${bad.join(', ')}` : 'package installs offline and loads');
  },
  D2(o) {
    return result(o.exit === 0 && o.summary.fail === 0 && o.summary.tests > 0, `${o.summary.pass}/${o.summary.tests} passed, ${o.summary.skipped} skipped`,
      o.failures.map((f) => `failed test: ${f}`));
  },
  D3(o) {
    const expect = [[o.alive, 'alive'], [o.dead, 'dead'], [o.replaced, 'dead'], [o.foreign_host, 'unknown'], [o.foreign_platform, 'unknown']];
    const ok = o.independent.relay === o.independent.date && o.tz_pairs.length === 4 && o.tz_pairs.every((p) => p.status === 'alive')
      && expect.every(([v, s]) => v.status === s) && o.launchd.valid && o.launchd.boot_id_null;
    return result(ok, ok ? 'identity agrees across readers and zones' : 'identity mismatch (see observations)',
      [`zombie child reads ${o.zombie.status} (${o.zombie.reason}) (spec item 5)`]);
  },
  D4(o) {
    const truncated = o.captures.filter((c) => c.truncated).map((c) => c.label);
    const ok = o.captures.length >= 3 && o.chain.ancestors_match && o.chain.tty_match && o.chain.resolved === o.chain.expected
      && o.native.recognized && o.native.executable_absolute && o.argv.ok && truncated.length === 0;
    return result(ok, truncated.length ? `ps truncated relay's capture of ${truncated.join(', ')} (spec item 1)` : ok ? 'table, ancestry and arguments agree' : 'ancestry, recognition or argument mismatch',
      [`Darwin comm holds ${COMM_KINDS[o.comm_kind] ?? 'an unexpected value'} (spec item 2)`,
       `process table: ${o.table.rows} rows, ${o.table.over_cut} past the cut, ${o.table.truncated} truncated as relay reads it`]);
  },
  D5(o) {
    const c = o.concurrent, r = o.reap, s = o.cost.n10.sessionend, p = o.cost.n10.pretool;
    const darwin = c.platforms.length === 1 && c.platforms[0] === 'darwin' && c.boot_ids_null;
    const sessionEnd = s.exit === 0 && s.stderr === '' && s.ms <= SESSIONEND_BUDGET_MS && s.ending_absent && s.revision_delta === 1 && s.others_retained;
    const preTool = p.exit === 0 && p.stderr === '' && p.allow && p.retained;
    const ok = c.expected === 8 && c.present === 8 && c.handles_match && o.lock.recovered && r.expected_removed.length === 4
      && same(r.removed, r.expected_removed) && same(r.kept, r.expected_kept) && sessionEnd && preTool && (o.platform !== 'darwin' || darwin);
    // n50 is a finding only; a missing or errored measurement says so and never decides D5.
    const n50 = o.cost.n50;
    const n50Finding = n50?.pretool && n50?.sessionend ? `50 agents: PreToolUse ${n50.pretool.ms} ms, SessionEnd ${n50.sessionend.ms} ms (exit ${n50.sessionend.exit})`
      : `50 agents: not measured (${n50?.error ? 'the measurement errored; see the D5 observations' : 'no record'})`;
    return result(ok, ok ? 'registry, lock, reap and hook cost hold' : 'registry, lock, reap or hook cost failed', [n50Finding]);
  },
  D6(o) {
    const ok = o.replies.length === 6 && o.replies.every((r) => r.match) && o.hang.length === 2
      && o.hang.every((h) => h.survivors.length === 0 && h.ms < h.budget_ms + 3000);
    return result(ok, ok ? 'replies match the Linux replay; hung guards refused and gone' : 'dispatch replay incomplete, mismatched, or a guard survived');
  },
  D8(o) {
    const ok = o.reap.exit === 0 && o.reap.expected_kept.length === 2 && same(o.reap.kept, o.reap.expected_kept) && o.reap.handles_unchanged;
    return result(ok, ok ? 'reap in a launchd-like environment keeps exactly the live agents' : 'reap in a minimal environment failed');
  },
};
const guarded = (fn, o) => { try { return fn(o); } catch { return { verdict: 'error', detail: 'malformed observations', findings: [] }; } };

function cutoverHarness(stage, name) {
  if (!stage) return 'missing';
  if (stage.status !== 'ran') return stage.status === 'absent' ? 'absent' : stage.status === 'skipped' ? 'skipped' : 'error';
  const o = stage.observations[name];
  if (!o) return 'error';
  if (o.status !== 'ran') return o.status === 'absent' ? 'absent' : o.status === 'skipped' ? 'skipped' : 'error';
  try { return o.preflight.allow && o.preflight.deny && o.proven === true && o.handle.ok === true ? 'pass' : 'fail'; } catch { return 'error'; }
}
function cutoverOpencode(stage) {
  if (!stage) return 'missing';
  if (stage.status !== 'ran') return stage.status === 'absent' ? 'absent' : stage.status === 'skipped' ? 'skipped' : 'error';
  try {
    const o = stage.observations;
    return o.version_match && o.install.exit === 0 && o.request.status === 200 && o.request.directory_match && o.plugin_log === 'loaded' && o.appeared
      && o.agent.count === 1 && o.agent.scope === 'process' && o.agent.matches_server && o.after.gone ? 'pass' : 'fail';
  } catch { return 'error'; }
}
// Confirmed truncation in a live hook's own ancestry is the spec's item-1 defect and blocks
// the release like D4's constructed chain; no live evidence leaves D4 as the width check.
function liveWidth(stage) {
  const ran = stage?.status === 'ran' ? Object.entries(stage.observations).filter(([, o]) => o?.status === 'ran' && o.hook) : [];
  const cut = ran.filter(([, o]) => o.hook.truncated === true).map(([h]) => h);
  if (!ran.length) return { verdict: 'pass', detail: 'no live hook ancestry recorded; D4 carries the width check', findings: [] };
  return result(cut.length === 0, cut.length ? `ps truncated live hook ancestry for ${cut.join(', ')} (spec item 1)` : 'live hook ancestry read in full');
}

export function judge(results) {
  const checks = {};
  const platform = results.manifest.platform;
  for (const id of RELEASE) {
    const stage = results.stages[id];
    if (!stage) { checks[id] = { class: 'release', verdict: 'missing', detail: 'stage did not run', findings: [] }; continue; }
    // Never stage.reason: it can carry raw paths and host names, and verdicts are exported.
    if (stage.status !== 'ran') { checks[id] = { class: 'release', verdict: stage.status === 'skipped' ? 'skipped' : 'error', detail: `stage ${stage.status}`, findings: [] }; continue; }
    const observations = id === 'D5' ? { ...stage.observations, platform } : stage.observations;
    checks[id] = { class: 'release', ...guarded(rules[id], observations) };
  }
  const changed = results.manifest.isolation?.changed, duringD9 = results.manifest.isolation?.changed_during_d9 ?? [];
  // D9 invites the user's own live sessions, which may write their config; the gating reading
  // is taken before it, and what changed afterwards is reported only.
  const writtenBack = results.manifest.isolation?.written_back ?? [];
  const d9Findings = [...(duringD9.length ? [`changed while D9 sampled live sessions (not gated): ${duringD9.join(', ')}`] : []),
    ...(writtenBack.length ? [`the guard probe wrote back a refreshed login (ops-4130ea; not gated): ${writtenBack.join(', ')}`] : [])];
  checks.ISO = { class: 'release', ...(Array.isArray(changed) ? result(changed.length === 0, changed.length ? `live paths changed: ${changed.join(', ')}` : 'no live path changed', d9Findings)
    : { verdict: 'error', detail: 'isolation fingerprints missing', findings: [] }) };
  checks.D7w = { class: 'release', ...liveWidth(results.stages.D7) };
  const d8 = results.stages.D8?.status === 'ran' ? results.stages.D8.observations.hook_path : null;
  const cutover = { 'claude-code': cutoverHarness(results.stages.D7, 'claude-code'), codex: cutoverHarness(results.stages.D7, 'codex'),
    opencode: cutoverOpencode(results.stages.D7b), 'launchd-path': d8 ? (d8.denied === true ? 'pass' : 'fail') : 'error' };
  const verdicts = Object.values(checks).map((c) => c.verdict);
  const release = results.manifest.allow_linux ? 'smoke'
    : verdicts.some((v) => !['pass', 'fail'].includes(v)) ? 'incomplete'
    : verdicts.every((v) => v === 'pass') ? 'pass' : 'fail';
  return { schema: 1, release, checks, cutover };
}
