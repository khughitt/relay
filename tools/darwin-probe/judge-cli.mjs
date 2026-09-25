#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const rows = Object.entries(verdict.checks).map(([id, c]) => `| ${[id, c.class, c.verdict, c.detail].map(cell).join(' | ')} |`).join('\n');
  const findings = Object.entries(verdict.checks).flatMap(([id, c]) => c.findings.map((f) => `- ${id}: ${f}`)).join('\n');
  const harness = Object.entries(d0.harnesses ?? {}).map(([n, h]) => `${n} ${h ? `${h.version} (${h.real ?? h.path})` : 'absent'}`).join('; ');
  const d4 = results.stages.D4?.observations;
  return `\n## Attempt ${m.started} — ${m.platform}${m.allow_linux ? ' (smoke)' : ''}\n\n`
    + `relay \`${m.relay_commit}\`, ops \`${m.ops_commit}\`; macOS ${d0.sw_vers?.ProductVersion ?? '-'} (${d0.sw_vers?.BuildVersion ?? '-'}), ${d0.arch}; `
    + `node ${d0.versions?.node}, ${d0.versions?.python3}; harnesses: ${harness}.\n\n`
    + `Release: **${verdict.release}**. Cutover: ${Object.entries(verdict.cutover).map(([k, v]) => `${k} ${v}`).join(', ')}.\n\n`
    + `| Check | Class | Verdict | Detail |\n| --- | --- | --- | --- |\n${rows}\n\n**Findings**\n\n${findings || '- none'}\n`
    + (d4?.table ? `\n**ps width:** ${d4.table.rows} rows, ${d4.table.over_cut} past the cut, ${d4.table.truncated} truncated as relay reads them; comm holds the ${d4.comm_kind}.\n` : '');
}
// An operator mistake or a rejected tarball: one line on stderr, no stack. Exit 2 for usage
// and environment (arguments, cwd, ops checkout, tools), 1 for results that are refused.
class JudgeError extends Error { constructor(message, exitCode) { super(message); this.exitCode = exitCode; } }
const usage = (message) => new JudgeError(message, 2), refuse = (message) => new JudgeError(message, 1);
const firstLine = (s) => String(s ?? '').trim().split('\n')[0];
const RUNBOOK = 'docs/runbooks/darwin-probe.md', EVIDENCE = 'docs/runbooks/darwin-evidence.json';
const PROVEN = 'import json,runpy,sys; p=runpy.run_path(sys.argv[1])["proven"]; print(json.dumps(bool(p(json.load(open(sys.argv[2])),json.load(open(sys.argv[3]))))))';
function readJson(dir, file) {
  if (!existsSync(join(dir, file))) throw refuse(`${file} is missing from the results tarball`);
  try { return JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch (error) { throw refuse(`${file} is not valid JSON: ${firstLine(error.message)}`); }
}
function readVerdict(dir, file) {
  const v = readJson(dir, file);
  if (typeof v?.release !== 'string' || typeof v.checks !== 'object' || v.checks === null || typeof v.cutover !== 'object' || v.cutover === null
    || Object.values(v.checks).some((c) => typeof c?.class !== 'string' || typeof c.verdict !== 'string')) throw refuse(`${file} is malformed`);
  return v;
}
function readResults(dir) {
  const manifest = readJson(dir, 'manifest.json');
  if (manifest?.schema !== 1) throw refuse(`results schema ${manifest?.schema} is not 1; judge them with the relay commit that built the bundle`);
  try { return loadResults(dir); } catch (error) {
    if (error instanceof SyntaxError) throw refuse(`a stage record is not valid JSON: ${firstLine(error.message)}`);
    throw error;
  }
}
async function main() {
  let values;
  try { ({ values } = parseArgs({ options: { tarball: { type: 'string' }, ops: { type: 'string' } } })); } catch (error) { throw usage(firstLine(error.message)); }
  if (!values.tarball || !values.ops) throw usage('usage: judge-cli.mjs --tarball <results tarball> --ops <ops checkout>');
  if (!existsSync(RUNBOOK)) throw usage(`${RUNBOOK} not found under ${process.cwd()}; run from the relay checkout`);
  if (!existsSync(values.tarball)) throw usage(`tarball not found: ${values.tarball}`);
  const dir = mkdtempSync(join(tmpdir(), 'dpj-'));
  try {
    try { execFileSync('tar', ['xzf', values.tarball, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (error) { throw refuse(`cannot extract ${values.tarball}: ${firstLine(error.stderr) || error.message}`); }
    const results = readResults(dir);
    const problems = crossCheck(results, readVerdict(dir, 'verdict.raw.json'), readVerdict(dir, 'verdict.redacted.json'));
    const probe = join(dir, 'relay-guard-probe'), commit = results.manifest.ops_commit;
    try { writeFileSync(probe, execFileSync('git', ['-C', values.ops, 'show', `${commit}:bin/relay-guard-probe`], { stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (error) { throw usage(`ops checkout ${values.ops} cannot provide bin/relay-guard-probe at ${commit}: ${firstLine(error.stderr) || error.message}`); }
    for (const [h, o] of Object.entries(results.stages.D7?.observations ?? {})) {
      if (o?.status !== 'ran' || !o.summary) continue;
      const s = join(dir, `${h}-summary.json`), e = join(dir, `${h}-evidence.json`);
      writeFileSync(s, JSON.stringify({ harness: h, ...o.summary })); writeFileSync(e, JSON.stringify(o.evidence));
      let again;
      try { again = JSON.parse(execFileSync('python3', ['-c', PROVEN, probe, s, e], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
      catch (error) {
        if (error.code === 'ENOENT') throw usage('python3 is required to re-derive D7 proven');
        throw refuse(`D7 ${h}: proven could not be recomputed: ${firstLine(error.stderr?.trim().split('\n').pop()) || error.message}`);
      }
      if (again !== o.proven) problems.push(`D7 ${h}: recorded proven ${o.proven}, recomputed ${again}`);
    }
    if (problems.length) throw refuse(problems.join('\n'));
    const verdict = judge(results);
    appendFileSync(RUNBOOK, renderSection(results, verdict));
    writeFileSync(EVIDENCE, `${JSON.stringify({ manifest: results.manifest, verdict }, null, 2)}\n`);
    process.stdout.write(`release: ${verdict.release}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Only the known operator-error class is reduced to its message; anything else is a
  // programming error and surfaces with its stack.
  try { await main(); } catch (error) {
    if (!(error instanceof JudgeError)) throw error;
    process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode;
  }
}
