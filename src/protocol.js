import { isAbsolute } from 'node:path';
export const STATES = Object.freeze(['idle', 'working', 'needs-input', 'needs-approval', 'done', 'error']);
export const KINDS = Object.freeze(['session-start', 'prompt', 'before-tool', 'activity', 'idle', 'needs-input', 'needs-approval', 'turn-end', 'turn-error', 'session-end']);
export const relayError = (code, message, cause) => Object.assign(new Error(message, { cause }), { code });
const fail = (message) => { throw relayError('INVALID_SCHEMA', message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const absolute = (v) => text(v) && isAbsolute(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const harnesses = ['claude-code', 'codex', 'opencode'];
export function parseStart(text) {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text)
      || text.length > 20 || BigInt(text) > 18446744073709551615n) {
    throw relayError('INVALID_SCHEMA', 'start must be canonical decimal u64 text');
  }
  return text;
}
export function validateHandle(v) {
  if (!object(v) || !['linux', 'darwin'].includes(v.platform) || !text(v.host)
      || !Number.isInteger(v.pid) || v.pid <= 0 || v.pid > 4294967295
      || !(v.bootId === null || (v.platform === 'linux' && uuid(v.bootId)))) fail('invalid process handle');
  return { platform: v.platform, host: v.host, bootId: v.bootId, pid: v.pid, start: parseStart(v.start) };
}
function identity(v, id) {
  if (!harnesses.includes(v.harness) || !text(v.sessionId) || id !== `${v.harness}:${v.sessionId}`
      || !absolute(v.cwd)) fail('invalid agent identity');
}
function validateAgent(v, key) {
  if (!object(v)) fail('invalid agent');
  identity(v, v.id);
  if (v.id !== key || v.scope !== (v.harness === 'opencode' ? 'process' : 'session')
      || !(v.repoRoot === null || absolute(v.repoRoot)) || !(v.remote === null || text(v.remote))
      || !text(v.projectKey) || !text(v.project) || !STATES.includes(v.state) || !integer(v.updatedAt)) fail('invalid agent');
  return { id: v.id, harness: v.harness, sessionId: v.sessionId, scope: v.scope,
    process: v.process === null ? null : validateHandle(v.process), cwd: v.cwd,
    repoRoot: v.repoRoot, remote: v.remote, projectKey: v.projectKey, project: v.project,
    state: v.state, updatedAt: v.updatedAt };
}
export function validateSnapshot(v) {
  if (!object(v) || v.schema !== 1 || !uuid(v.generation) || !integer(v.revision) || !object(v.agents)) fail('invalid registry snapshot');
  return { schema: 1, generation: v.generation, revision: v.revision,
    agents: Object.fromEntries(Object.entries(v.agents).map(([key, agent]) => [key, validateAgent(agent, key)])) };
}
export function validateEvent(v) {
  if (!object(v) || v.schema !== 1 || !KINDS.includes(v.kind) || !text(v.nativeEvent)) fail('invalid event');
  identity(v, v.agentId);
  if (Object.hasOwn(v, 'stopHookActive') && typeof v.stopHookActive !== 'boolean') fail('invalid stop flag');
  let tool = null;
  if (v.kind === 'before-tool') {
    if (!object(v.tool) || !text(v.tool.name) || !object(v.tool.input)
        || !(v.tool.command === null || typeof v.tool.command === 'string')) fail('invalid tool');
    tool = { name: v.tool.name, input: v.tool.input, command: v.tool.command };
  } else if (v.tool !== null) fail('unexpected tool');
  return { schema: 1, kind: v.kind, harness: v.harness, nativeEvent: v.nativeEvent,
    agentId: v.agentId, sessionId: v.sessionId, cwd: v.cwd,
    ...(Object.hasOwn(v, 'stopHookActive') ? { stopHookActive: v.stopHookActive } : {}), tool };
}
