// @ts-check
// Claude Code native hook selection probe and offline verdicts for latency-support evidence.
//   node selection.mjs prepare --settings FILE --output NEW_RUN_DIR --side baseline|candidate [--sleep SEC]
//   node selection.mjs run --settings FILE --output NEW_RUN_DIR --side baseline|candidate --mode interactive|print [--sleep SEC] [--claude PATH]
//   node selection.mjs verdict [--sleep SEC] RUN_DIR...
//   node selection.mjs map MANIFEST_SET BASELINE_RUN CANDIDATE_RUN EVENT
// The recorder subcommand is invoked by the harness, not by operators.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { commandWords } from './hook-settings.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
function requireThat(ok, message) { if (!ok) throw new Error(message); }

export function prepareSelection({ settings, output, side, sleep = 0 }) {
  requireThat(['baseline', 'candidate'].includes(side), '--side must be baseline or candidate');
  requireThat(Number.isFinite(sleep) && sleep >= 0, '--sleep must be a nonnegative number');
  const sourceBytes = readFileSync(settings);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  requireThat(source.hooks && typeof source.hooks === 'object' && !Array.isArray(source.hooks), 'settings need a hooks table');
  const runDir = resolve(output);
  mkdirSync(runDir, { mode: 0o700 });
  for (const dir of ['home/.claude', 'work', 'requests', 'payloads']) mkdirSync(join(runDir, dir), { recursive: true, mode: 0o700 });
  const hooks = structuredClone(source.hooks), expected = {}, script = fileURLToPath(import.meta.url);
  for (const [event, groups] of Object.entries(hooks)) {
    requireThat(Array.isArray(groups), `${event}: hook groups must be an array`);
    let index = 0;
    for (const group of groups) {
      requireThat(Array.isArray(group.hooks), `${event}: a hook group needs hooks`);
      for (const hook of group.hooks) {
        requireThat(hook.type === 'command' && typeof hook.command === 'string'
          && Object.keys(hook).every((key) => ['type', 'command', 'timeout'].includes(key)), `${event} ${index}: unsupported hook options`);
        const matcher = group.matcher;
        (expected[event] ??= []).push({ index, matcher, timeout: hook.timeout, command: hook.command });
        hook.command = [process.execPath, script, 'record', runDir, side, event, index, sleep].map(quote).join(' ');
        index++;
      }
    }
  }
  writeJson(join(runDir, 'home/.claude/settings.json'), { hooks });
  writeJson(join(runDir, 'expected-entries.json'), expected);
  writeJson(join(runDir, 'probe.json'), { side, sleep });
  writeFileSync(join(runDir, 'source.sha256'), `${sha(sourceBytes)}  ${settings}\n`, { mode: 0o600 });
  return { runDir, events: Object.fromEntries(Object.entries(expected).map(([event, entries]) => [event, entries.length])) };
}

function recordSelection(argv) {
  const [runDir, side, event, indexText, sleepText = '0'] = argv;
  const index = Number(indexText), sleep = Number(sleepText);
  requireThat(runDir && side && event && Number.isSafeInteger(index) && Number.isFinite(sleep) && sleep >= 0, 'invalid recorder arguments');
  const stamp = () => (Date.now() / 1000).toFixed(3);
  const line = (what) => `${side} ${event} ${index} ${process.pid} ${what} ${stamp()}\n`;
  appendFileSync(join(runDir, 'selection.log'), line('start'), { mode: 0o600 });
  writeFileSync(join(runDir, 'payloads', `${event}-${index}-${Date.now()}-${process.pid}.json`), readFileSync(0), { mode: 0o600 });
  if (sleep > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(sleep * 1000));
  appendFileSync(join(runDir, 'selection.log'), line('end'), { mode: 0o600 });
}

function logs(runDir) {
  const text = readFileSync(join(runDir, 'selection.log'), 'utf8');
  return text.split('\n').filter(Boolean).map((line, ordinal) => {
    const [side, event, index, pid, what, time] = line.split(' ');
    return { side, event, index: Number(index), pid: Number(pid), what, time: Number(time), ordinal };
  });
}

export function judgeSelection(runDirs, { sleep = 0 } = {}) {
  const reports = [];
  let ok = true;
  for (const runDir of runDirs) {
    const expected = readJson(join(runDir, 'expected-entries.json'));
    const records = logs(runDir);
    const side = records[0]?.side;
    requireThat(side, `${runDir}: the selection log has no recorder side`);
    const debug = sleep > 0 ? ['debug-1.log', 'debug-2.log'].map((file) => { try { return readFileSync(join(runDir, file), 'utf8'); } catch { return ''; } }) : [];
    const payloadDir = join(runDir, 'payloads');
    const malformedPayloads = [];
    const payloadRecords = readdirSync(payloadDir).flatMap((file) => {
      const match = /^(SessionStart|Stop)-(\d+)-(\d+)(?:-(\d+))?\.json$/.exec(file);
      const stamp = match ? Number(match[3]) : NaN;
      const archive = match && match[4] === undefined && stamp >= 1e15;
      const current = match && match[4] !== undefined && stamp >= 1e11 && stamp < 1e15;
      if (!match || (!archive && !current)) {
        if (/^(SessionStart|Stop)-/.test(file)) malformedPayloads.push(file);
        return [];
      }
      const time = archive ? stamp / 1e9 : stamp / 1e3;
      const path = join(payloadDir, file);
      return [{ event: match[1], index: Number(match[2]), pid: match[4] ? Number(match[4]) : null, time, path, value: readJson(path), start: null }];
    });
    for (const payload of payloadRecords) {
      const entry = (expected[payload.event] ?? []).find((item) => item.index === payload.index);
      const timesOut = sleep > 0 && entry && entry.timeout !== undefined && entry.timeout !== null && entry.timeout < sleep;
      let candidates = records.filter((r) => r.event === payload.event && r.index === payload.index && r.what === 'start');
      if (payload.pid !== null) candidates = candidates.filter((r) => r.pid === payload.pid);
      candidates = candidates.filter((start) => {
        if (payload.time < start.time) return false;
        const end = records.find((r) => r.event === payload.event && r.index === payload.index && r.pid === start.pid && r.what === 'end');
        if (end) return payload.time <= end.time;
        return timesOut ? payload.time <= start.time + entry.timeout : true;
      });
      if (candidates.length === 1) payload.start = candidates[0];
    }
    const resumeOrder = Math.min(...payloadRecords.filter((r) => r.event === 'SessionStart' && r.value.source === 'resume' && r.start).map((r) => r.start.ordinal));
    const checks = malformedPayloads.map((file) => `malformed payload filename ${file} FAIL`);
    ok &&= malformedPayloads.length === 0;
    for (const event of ['SessionStart', 'Stop']) {
      const entries = expected[event];
      requireThat(Array.isArray(entries), `${runDir}: expected entries lack ${event}`);
      const expectedIndices = new Set(entries.map((entry) => entry.index));
      const fired = new Set(records.filter((r) => r.event === event && r.what === 'start').map((r) => r.index));
      const payloadIndices = new Set(payloadRecords.filter((r) => r.event === event).map((r) => r.index));
      let good = true;
      const counts = {};
      for (const index of new Set([...expectedIndices, ...fired, ...payloadIndices])) {
        const entry = entries.find((item) => item.index === index);
        const startRecords = records.filter((r) => r.event === event && r.index === index && r.what === 'start');
        const endRecords = records.filter((r) => r.event === event && r.index === index && r.what === 'end');
        const invocations = payloadRecords.filter((r) => r.event === event && r.index === index);
        const timesOut = sleep > 0 && entry && entry.timeout !== undefined && entry.timeout !== null && entry.timeout < sleep;
        const expectedEnds = timesOut ? 0 : 2;
        let payloadGood = invocations.length === 2 && invocations.every((r) => r.start)
          && startRecords.every((start) => invocations.some((r) => r.start === start));
        for (const invocation of invocations) {
          if (!invocation.start) { payloadGood = false; continue; }
          const correspondingEnds = records.filter((r) => r.event === event && r.index === index && r.what === 'end' && r.pid === invocation.start.pid).length;
          if (correspondingEnds !== (timesOut ? 0 : 1)) payloadGood = false;
        }
        if (event === 'SessionStart') {
          payloadGood &&= invocations.filter((r) => r.value.source === 'startup').length === 1
            && invocations.filter((r) => r.value.source === 'resume').length === 1;
        } else {
          payloadGood &&= invocations.filter((r) => r.start?.ordinal < resumeOrder).length === 1
            && invocations.filter((r) => r.start?.ordinal > resumeOrder).length === 1;
        }
        let entryGood = expectedIndices.has(index) && startRecords.length === 2 && endRecords.length === expectedEnds && payloadGood;
        if (timesOut) {
          const evidence = `${side} ${event} ${index} ${sleep}] timed out after ${entry.timeout * 1000}ms`;
          const eachTurn = debug.every((text) => text.includes(evidence));
          entryGood &&= eachTurn;
          if (eachTurn) checks.push(`${event} ${index} timed out after ${entry.timeout * 1000}ms`);
        }
        good &&= entryGood;
        counts[index] = `${startRecords.length} start/${endRecords.length} end/${invocations.length} payloads`;
      }
      good &&= [...fired].every((index) => expectedIndices.has(index));
      good &&= [...payloadIndices].every((index) => expectedIndices.has(index));
      ok &&= good;
      checks.push(`${event} expected ${JSON.stringify([...expectedIndices])} ${JSON.stringify(counts)} ${good ? 'PASS' : 'FAIL'}`);
    }
    const payloads = payloadRecords.filter((r) => r.event === 'SessionStart').sort((a, b) => a.time - b.time).map((r) => ({
      source: r.value.source ?? null, bytes: readFileSync(r.path).byteLength,
      extra: Object.keys(r.value).filter((key) => !['cwd', 'hook_event_name', 'session_id', 'source', 'transcript_path'].includes(key)).sort() }));
    reports.push({ runDir, checks, payloads });
  }
  return { ok, reports };
}

function entryName(expectedEntry) {
  const words = commandWords(expectedEntry.command);
  return basename(words[0]) === 'node' && words.some((word) => basename(word) === 'relay.js') ? 'relay' : basename(words[0]);
}
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export function mapSelection({ manifest, baselineRun, candidateRun, event }) {
  const set = readJson(manifest), route = (set.manifests ?? [set]).find((item) => item.event === event);
  requireThat(route, `${manifest}: no ${event} manifest`);
  const entries = (run) => (readJson(join(run, 'expected-entries.json'))[event] ?? []).map((item) => ({
    name: entryName(item), timeout: item.timeout ?? null, matcher: item.matcher ?? null, command: item.command }));
  const baseline = entries(baselineRun), candidate = entries(candidateRun);
  const mapping = {};
  for (const branch of route.branches) {
    const name = branch.role === 'deployed-relay' ? 'relay' : branch.settingsEntry ?? branch.name.split('.')[0];
    (mapping[name] ??= []).push(branch.name);
  }
  const retained = route.branches.filter((branch) => branch.role === 'native' && branch.migrates === false).map((branch) => branch.settingsEntry ?? branch.name.split('.')[0]);
  const branchNames = new Set(route.branches.map((branch) => branch.name));
  const missingReplacements = (route.replacementMap ?? []).map((item) => item.baseline)
    .filter((name) => typeof name === 'string' && !name.includes(':') && !branchNames.has(name));
  const baselineGood = same(baseline.map((entry) => entry.name), Object.keys(mapping)) && missingReplacements.length === 0;
  const retainedGood = retained.every((name) => {
    const before = baseline.filter((entry) => entry.name === name), after = candidate.filter((entry) => entry.name === name);
    return before.length === 1 && after.length === 1
      && ['command', 'matcher', 'timeout'].every((key) => isDeepStrictEqual(before[0][key], after[0][key]));
  });
  const candidateGood = same(candidate.map((entry) => entry.name), ['relay', ...retained]) && retainedGood;
  return { ok: baselineGood && candidateGood,
    baseline: { entries: baseline, mapping, ok: baselineGood },
    candidate: { entries: candidate, expected: ['relay', ...retained], ok: candidateGood } };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'record') { recordSelection(argv); return 0; }
  if (command === 'prepare' || command === 'run') {
    const { values } = parseArgs({ args: argv, options: { settings: { type: 'string' }, output: { type: 'string' }, side: { type: 'string' }, sleep: { type: 'string' },
      ...(command === 'run' ? { mode: { type: 'string' }, claude: { type: 'string' } } : {}) } });
    requireThat(values.settings && values.output && values.side, `${command} needs --settings, --output and --side`);
    const result = prepareSelection({ settings: resolve(values.settings), output: values.output, side: values.side, sleep: Number(values.sleep ?? 0) });
    if (command === 'run') {
      requireThat(['interactive', 'print'].includes(values.mode), 'run needs --mode interactive or print');
      const { runClaudeTurns } = await import('./live.mjs');
      await runClaudeTurns({ runDir: result.runDir, mode: values.mode, claude: values.claude, label: values.side,
        replies: [{ text: 'selection first turn done' }, { text: 'selection resumed turn done' }, { text: 'unexpected third answer' }],
        sleep: Number(values.sleep ?? 0) });
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === 'verdict') {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { sleep: { type: 'string' } } });
    requireThat(positionals.length > 0, 'verdict needs RUN_DIR...');
    const report = judgeSelection(positionals.map((dir) => resolve(dir)), { sleep: Number(values.sleep ?? 0) });
    for (const run of report.reports) {
      process.stdout.write(`${basename(run.runDir)} | ${run.checks.join(' | ')}\n`);
      process.stdout.write(`  SessionStart payloads ${JSON.stringify(run.payloads)}\n`);
    }
    process.stdout.write(`${report.ok ? 'ALL PASS' : 'SOME FAIL'}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === 'map') {
    requireThat(argv.length === 4, 'map needs MANIFEST_SET BASELINE_RUN CANDIDATE_RUN EVENT');
    const [manifest, baselineRun, candidateRun, event] = argv;
    const report = mapSelection({ manifest: resolve(manifest), baselineRun: resolve(baselineRun), candidateRun: resolve(candidateRun), event });
    const mapping = Object.entries(report.baseline.mapping).map(([name, branches]) => `${name}=${branches.join(',')}`).join(' ');
    process.stdout.write(`${event} baseline: entries ${JSON.stringify(report.baseline.entries)} -> branches ${mapping} ${report.baseline.ok ? 'PASS' : 'FAIL'}\n`);
    process.stdout.write(`${event} candidate: entries ${JSON.stringify(report.candidate.entries)} -> candidate relay + retained ${JSON.stringify(report.candidate.expected)} ${report.candidate.ok ? 'PASS' : 'FAIL'}\n`);
    return report.ok ? 0 : 1;
  }
  throw new Error('expected prepare, run, verdict, map or record');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`selection.mjs: ${error.message}\n`); process.exitCode = 2; }
}
