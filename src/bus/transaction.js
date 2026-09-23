import { randomUUID } from 'node:crypto';
import { relayError, validateEvent, validateSnapshot } from '../protocol.js';
import { adapterFor } from '../adapters/index.js';
import { paths as defaultPaths } from './paths.js';
import { createProcessOps } from './proc.js';
import { gitContext as defaultGitContext, projectKeyFor, displayProject } from './identity.js';
import { readJson, writeJsonAtomic } from './store.js';
import { withLock } from './lock.js';
import { pruneDead } from './prune.js';
function options(given) {
  const clock = given.clock ?? performance.now.bind(performance);
  return { ...given, clock, deadline:given.deadline ?? clock()+12000, paths:given.paths ?? defaultPaths(),
    processOps:given.processOps ?? createProcessOps(), now:given.now ?? Date.now, uuid:given.uuid ?? randomUUID };
}
// Schema 1 published the terminal owner's pid; schema 2 publishes the session's own process.
// A schema-1 row can hold a handle borrowed from another session, and which of two rows sharing
// a handle is rightful cannot be told, so its rows are dropped rather than migrated. Spec:
// docs/specs/2026-09-23-session-process-handle.md, "Rollout and recovery".
const SUPERSEDED_MESSAGE = 'registry predates session handles; run relay reap or wait for any hook event';
const isSchemaOne = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && value.schema === 1;
async function read(opts) {
  const value = await readJson(opts.paths.agentsPath,opts);
  if (value === undefined) return null;
  if (isSchemaOne(value)) throw relayError('REGISTRY_SUPERSEDED',SUPERSEDED_MESSAGE);
  return validateSnapshot(value);
}
async function readForMutation(opts, diagnostics) {
  const value = await readJson(opts.paths.agentsPath,opts);
  if (value === undefined) return {before:null,superseded:false};
  if (!isSchemaOne(value)) return {before:validateSnapshot(value),superseded:false};
  const agents = value.agents;
  const ids = agents !== null && typeof agents === 'object' && !Array.isArray(agents) ? Object.keys(agents) : [];
  diagnostics.push(...(ids.length === 0
    ? [{code:'REGISTRY_SUPERSEDED',message:'replaced a schema-1 registry with no agents'}]
    : ids.map(agentId=>({code:'REGISTRY_SUPERSEDED',message:`dropped ${agentId} from a superseded schema-1 registry`,agentId}))));
  return {before:null,superseded:true};
}
export async function readSnapshot(given = {}) { return read(options(given)); }
export async function listAgents(given = {}) {
  const opts = options(given), snapshot = await read(opts);
  const liveness = Object.fromEntries(Object.entries(snapshot?.agents ?? {}).map(([id,a]) => [id,opts.processOps.probe(a.process,opts)]));
  return {snapshot,liveness};
}
const diagnosticsFor = (liveness) => Object.entries(liveness).filter(([,v])=>v.status === 'unknown')
  .map(([agentId])=>({code:'PROCESS_UNAVAILABLE',message:'agent liveness unknown',agentId}));
async function mutate(opts, event, context, handle, diagnostics) {
  const locked = await withLock(opts.paths.lockPath,async () => {
    const {before,superseded} = await readForMutation(opts,diagnostics);
    const {agents,reaped,liveness} = pruneDead(before?.agents ?? {},{probe:h=>opts.processOps.probe(h,opts)});
    diagnostics.push(...diagnosticsFor(liveness));
    let changed = superseded || reaped.length > 0;
    if (event) {
      const adapter = adapterFor(event.harness), level = adapter.stateForEvent(event.nativeEvent);
      if (level === null) { changed ||= Object.hasOwn(agents,event.agentId); delete agents[event.agentId]; }
      else {
        const state = adapter.reduceState(level,agents[event.agentId]?.state ?? null);
        const {remote,repoRoot} = context;
        agents[event.agentId] = {id:event.agentId,harness:event.harness,sessionId:event.sessionId,
          scope:event.harness === 'opencode' ? 'process' : 'session',process:handle,cwd:event.cwd,repoRoot,remote,
          projectKey:projectKeyFor({...context,cwd:event.cwd}),project:displayProject({...context,cwd:event.cwd}),state,updatedAt:opts.now()};
        changed = true;
      }
    }
    if (!changed) return {snapshot:before,changed:false,reaped,diagnostics};
    const snapshot = validateSnapshot({schema:2,generation:before?.generation ?? opts.uuid(),revision:(before?.revision ?? 0)+1,agents});
    await writeJsonAtomic(opts.paths.agentsPath,snapshot,opts);
    return {snapshot,changed:true,reaped,diagnostics};
  },opts);
  if (locked.cleanupError) locked.value.diagnostics.push({code:locked.cleanupError.code,
    message:locked.value.changed ? 'publication completed; lock cleanup failed' : 'registry unchanged; lock cleanup failed'});
  return locked.value;
}
export async function applyEvent(value, given = {}) {
  const event = validateEvent(value), adapter = adapterFor(event.harness);
  adapter.stateForEvent(event.nativeEvent);
  if (adapter.events[event.nativeEvent].kind !== event.kind) throw relayError('INVALID_SCHEMA','event kind does not match native event');
  const opts = options(given), diagnostics = [];
  let context = null, handle = null;
  if (event.kind !== 'session-end') {
    context = await (given.gitContext ?? defaultGitContext)(event.cwd,opts);
    try {
      const pid = given.resolveAgentPid ? given.resolveAgentPid(adapter) : adapter.resolveAgentPid({ancestors:p=>opts.processOps.ancestors(p,opts)});
      handle = pid === null ? null : opts.processOps.handleOf(pid,opts);
    } catch (cause) {
      if (!['PROCESS_UNREADABLE','PROCESS_UNAVAILABLE'].includes(cause.code)) throw cause;
    }
    if (!handle) diagnostics.push({code:'PROCESS_UNAVAILABLE',message:'agent process identity unavailable',agentId:event.agentId});
  }
  return mutate(opts,event,context,handle,diagnostics);
}
export async function reapRegistry(given = {}) { return mutate(options(given),null,null,null,[]); }
