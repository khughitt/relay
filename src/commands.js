// @ts-check
// The declared surface. bin/relay.js keeps its strict, order-sensitive hook parser (the
// harness protocol depends on it) but takes option names, value sets, and help from here.
export const HARNESSES = ['claude-code', 'codex', 'opencode'];
/** @type {import("./types.js").Command[]} */
export const COMMANDS = [
  { path: ['list'], summary: 'The live-agent registry' },
  { path: ['reap'], summary: 'Reconcile the registry against live processes', options: [{ names: ['--outer-ms'], value: 'int' }] },
  { path: ['hook'], summary: 'Dispatch one harness hook event to the subscribers and guards', protocol: "harness hook: stdout is the reply, exit code is the guard's",
    args: [{ name: 'event', value: 'string', required: true }],
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--outer-ms'], value: 'int' }, { names: ['--subscribers'], value: 'path' }] },
  { path: ['install'], summary: "Plan, and with --apply write, a harness's hook installation", output: 'json',
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--subscribers'], value: 'path', required: true }, { names: ['--target'], value: 'path' }, { names: ['--config-dir'], value: 'path' }, { names: ['--evidence'], value: 'path' }, { names: ['--retire'], value: 'enum', values: ['familiar'] }, { names: ['--with'], value: 'enum', values: ['ask'] }, { names: ['--node'], value: 'path' }, { names: ['--artifact'], value: 'path' }, { names: ['--apply'], value: 'none' }] },
  { path: ['rollback'], summary: 'Undo an applied installation from its artifact', output: 'none', options: [{ names: ['--artifact'], value: 'path', required: true }] },
  { path: ['serve'], summary: 'Run the interaction service: inbox, local socket and optional HTTP surface', output: 'none' },
  { path: ['ask'], summary: 'Route one harness question through the inbox', protocol: 'harness hook: stdout is the reply; always exits 0',
    args: [{ name: 'event', value: 'enum', values: ['PreToolUse', 'PostToolUse'], required: true }],
    options: [{ names: ['--harness'], value: 'enum', values: HARNESSES, required: true }, { names: ['--handback'], value: 'none' }] },
  { path: ['inbox'], summary: 'Manage questions and notices in the inbox', output: 'none' },
  { path: ['inbox', 'list'], summary: 'Questions and notices in the inbox', options: [{ names: ['--since'], value: 'int' }] },
  { path: ['inbox', 'show'], summary: 'One inbox entry in full', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['inbox', 'answer'], summary: 'Answer a pending question from this desk',
    args: [{ name: 'id', value: 'string', required: true }, { name: 'value', value: 'string', required: false, variadic: true }],
    options: [{ names: ['--decline'], value: 'none' }] },
  { path: ['inbox', 'defer'], summary: 'Defer a pending question to the desktop', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['inbox', 'withdraw'], summary: 'Withdraw a pending question', args: [{ name: 'id', value: 'string', required: true }] },
  { path: ['presence'], summary: 'Show or set whether questions go to the inbox', args: [{ name: 'mode', value: 'enum', values: ['here', 'away'], required: false }] },
  { path: ['model'], summary: "The model a Codex tool call's turn runs, read from its rollout",
    options: [{ names: ['--harness'], value: 'enum', values: ['codex'], required: true }] },
];

/** The command whose path is the longest prefix of argv; rest is what follows it. */
/** @param {string[]} argv */
export function commandFor(argv) {
  const matches = COMMANDS.filter((c) => c.path.every((w, i) => argv[i] === w)).sort((a, b) => b.path.length - a.path.length);
  return matches.length ? { cmd: matches[0], rest: argv.slice(matches[0].path.length) } : null;
}
/** @param {...string} words */
export function commandAt(...words) {
  return COMMANDS.find((c) => c.path.length === words.length && c.path.every((w, i) => w === words[i])) ?? null;
}

/** Strip --json/--pretty from anywhere; returns { argv, mode } with mode null when unset. */
/** @param {string[]} argv @param {(message: string) => Error} usage */
export function stripGlobals(argv, usage) {
  let mode = null;
  const rest = [];
  for (const a of argv) {
    if (a === '--json' || a === '--pretty') { const m = a.slice(2); if (mode && mode !== m) throw usage('--json and --pretty are mutually exclusive'); mode = m; }
    else rest.push(a);
  }
  return { argv: rest, mode };
}

/** The diagnostics format (errors, and results where the command has any) and, separately,
 *  whether a successful run prints anything: `output = "none"` silences success only. */
/** @param {string|null} flagMode @param {NodeJS.ProcessEnv} env @param {import("./types.js").Command|null} cmd @param {(message: string) => Error} usage */
export function resolveMode(flagMode, env, cmd, usage) {
  const mode = flagMode ?? env.RELAY_FORMAT ?? (cmd?.output === 'json' ? 'json' : 'pretty');
  if (!['json', 'pretty'].includes(mode)) throw usage(`RELAY_FORMAT must be json or pretty, got ${JSON.stringify(mode)}`);
  return { mode, silent: cmd?.output === 'none' };
}

/** @param {import("./types.js").Command} cmd */
export function helpText(cmd) {
  const opts = (cmd.options ?? []).map((o) => `${o.required ? '' : '['}${o.names[0]}${o.value === 'none' ? '' : ` ${o.values ? o.values.join('|') : o.value.toUpperCase()}`}${o.required ? '' : ']'}`);
  const args = (cmd.args ?? []).map((a) => a.name.toUpperCase());
  return `Usage: relay ${[...cmd.path, ...opts, ...args].join(' ')}\n\n${cmd.summary}.\n`;
}

export function rootHelp() {
  return `Usage: relay [--json|--pretty] <command>\n\n${COMMANDS.map((c) => `  ${c.path.join(' ').padEnd(15)} ${c.summary}`).join('\n')}\n\nRun 'relay <command> --help' for details.\n`;
}
