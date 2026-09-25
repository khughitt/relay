#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { judge } from './judge.mjs';
import { loadResults, stableVerdict } from './probe.mjs';
export function crossCheck(results, raw, redacted) {
  const now = JSON.stringify(stableVerdict(judge(results))), problems = [];
  if (JSON.stringify(stableVerdict(raw)) !== now) problems.push('verdict.raw.json disagrees with the recomputed verdict');
  if (JSON.stringify(stableVerdict(redacted)) !== now) problems.push('verdict.redacted.json disagrees with the recomputed verdict');
  if (!results.manifest.redaction?.files) problems.push('manifest has no redaction counts');
  return problems;
}
export function renderSection(results, verdict) {
  const m = results.manifest, d0 = results.stages.D0?.observations ?? {};
  const rows = Object.entries(verdict.checks).map(([id, c]) => `| ${id} | ${c.class} | ${c.verdict} | ${c.detail} |`).join('\n');
  const findings = Object.entries(verdict.checks).flatMap(([id, c]) => c.findings.map((f) => `- ${id}: ${f}`)).join('\n');
  const harness = Object.entries(d0.harnesses ?? {}).map(([n, h]) => `${n} ${h ? `${h.version} (${h.real ?? h.path})` : 'absent'}`).join('; ');
  const d4 = results.stages.D4?.observations;
  return `\n## Attempt ${m.started} — ${m.platform}${m.allow_linux ? ' (smoke)' : ''}\n\n`
    + `relay \`${m.relay_commit}\`, ops \`${m.ops_commit}\`; macOS ${d0.sw_vers?.ProductVersion ?? '-'} (${d0.sw_vers?.BuildVersion ?? '-'}), ${d0.arch}; `
    + `node ${d0.versions?.node}, ${d0.versions?.python3}; harnesses: ${harness}.\n\n`
    + `Release: **${verdict.release}**. Cutover: ${Object.entries(verdict.cutover).map(([k, v]) => `${k} ${v}`).join(', ')}.\n\n`
    + `| Check | Class | Verdict | Detail |\n| --- | --- | --- | --- |\n${rows}\n\n**Findings**\n\n${findings || '- none'}\n`
    + (d4 ? `\n**ps width:** ${d4.table.rows} rows, ${d4.table.over_cut} past the cut, ${d4.table.truncated} truncated as relay reads them; comm holds the ${d4.comm_kind}.\n` : '');
}
async function main() {
  const { values } = parseArgs({ options: { tarball: { type: 'string' }, ops: { type: 'string' } } });
  const dir = mkdtempSync(join(tmpdir(), 'dpj-'));
  try {
    execFileSync('tar', ['xzf', values.tarball, '-C', dir]);
    const results = loadResults(dir), read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const problems = crossCheck(results, read('verdict.raw.json'), read('verdict.redacted.json'));
    const probe = join(dir, 'relay-guard-probe');
    writeFileSync(probe, execFileSync('git', ['-C', values.ops, 'show', `${results.manifest.ops_commit}:bin/relay-guard-probe`]));
    for (const [h, o] of Object.entries(results.stages.D7?.observations ?? {})) {
      if (o.status !== 'ran' || !o.summary) continue;
      const s = join(dir, `${h}-summary.json`), e = join(dir, `${h}-evidence.json`);
      writeFileSync(s, JSON.stringify({ harness: h, ...o.summary })); writeFileSync(e, JSON.stringify(o.evidence));
      const again = JSON.parse(execFileSync('python3', ['-c', 'import json,runpy,sys; p=runpy.run_path(sys.argv[1])["proven"]; print(json.dumps(bool(p(json.load(open(sys.argv[2])),json.load(open(sys.argv[3]))))))', probe, s, e], { encoding: 'utf8' }));
      if (again !== o.proven) problems.push(`D7 ${h}: recorded proven ${o.proven}, recomputed ${again}`);
    }
    if (problems.length) { process.stderr.write(`${problems.join('\n')}\n`); process.exit(1); }
    const verdict = judge(results);
    appendFileSync('docs/runbooks/darwin-probe.md', renderSection(results, verdict));
    writeFileSync('docs/runbooks/darwin-evidence.json', `${JSON.stringify({ manifest: results.manifest, verdict }, null, 2)}\n`);
    process.stdout.write(`release: ${verdict.release}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();
