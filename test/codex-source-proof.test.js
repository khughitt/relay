import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const mod=await import('../tools/codex-question/source-proof.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
const root=process.env.RELAY_CODEX_SOURCE_ROOT,version=process.env.RELAY_CODEX_SOURCE_VERSION??'0.165.0';
function sources(){const pins=JSON.parse(readFileSync(new URL('../docs/evidence/codex-question-0.165.0.json',import.meta.url)));return Object.fromEntries([...pins.sources.map(p=>p.file),'core/src/context_manager/history.rs','rollout/src/policy.rs'].map(f=>[f,readFileSync(join(root,f),'utf8')]))}
test('source proof rejects absent input and unauthorized versions without accepting evidence',()=>{
 assert.equal(typeof mod.proveSourceInvariants,'function');assert.equal(mod.proveSourceInvariants({},'0.166.0').status,'failed');assert.equal(mod.proveSourceInvariants({},'0.167.0').status,'failed');
});
test('version-specific source invariants pass the actual archived source',{skip:!root},()=>{
 assert.equal(typeof mod.proveSourceInvariants,'function');const p=mod.proveSourceInvariants(sources(),version);assert.deepEqual(p.checks.filter(c=>!c.passed),[]);assert.equal(p.status,'passed');assert.equal(p.facts.unloadDefaultSeconds,version==='0.165.0'?1800:60);
});
for(const [id,file,from,to] of [
 ['builtin-answer-map','core/src/tools/handlers/request_user_input.rs','serde_json::to_string(&response)','"different answer encoding".to_string()'],
 ['serial-default','tools/src/tool_executor.rs','fn supports_parallel_tool_calls(&self) -> bool {\n        false','fn supports_parallel_tool_calls(&self) -> bool {\n        true'],
 ['serial-runtime','core/src/tools/parallel.rs','lock.write()','lock.read()'],
 ['turn-slot','core/src/session/mod.rs','ts.insert_pending_user_input(sub_id, tx_response)','ts.insert_pending_user_input(call_id, tx_response)'],
 ['decline-collisions','app-server/src/bespoke_event_handling.rs','answers: HashMap::new()','answers: unsafe_default()'],
 ['string-output','core/src/tools/context.rs','FunctionCallOutputBody::Text(text.clone())','FunctionCallOutputBody::ContentItems(vec![])'],
 ['status-broadcast','app-server/src/thread_status.rs','.send_server_notification(ServerNotification::ThreadStatusChanged(notification))','.send_to_subscribers(ServerNotification::ThreadStatusChanged(notification))'],
 ['waiting-status','app-server/src/thread_status.rs','runtime.pending_user_input_requests > 0','false'],
 ['resume-replay','app-server/src/request_processors/thread_lifecycle.rs','.replay_requests_to_connection_for_thread(connection_id, conversation_id)','.drop_requests_for_thread(conversation_id)'],
 ['unload-conditions','app-server/src/request_processors/thread_lifecycle.rs','((false, has_no_subscribers_since), (false, is_inactive_since))','((false, has_no_subscribers_since), (_, is_inactive_since))'],
 ['helper-set','tui/src/app/app_server_events.rs','"system" | "thread_title"','"thread_title"'],
 ['pid-identity','app-server-daemon/src/backend/pid.rs','process_identity: Option<identity::ProcessIdentity>','process_identity: String'],
 ['raw-rollout','rollout/src/policy.rs','| ResponseItem::FunctionCallOutput { .. }','| ResponseItem::UnknownOutput { .. }']
])test(`source invariant ${id} fails closed after its load-bearing condition changes`,{skip:!root},()=>{
 assert.equal(typeof mod.proveSourceInvariants,'function');const input=sources();assert.ok(input[file].includes(from),'fixture mutation must hit archived production source');input[file]=input[file].replace(from,to);const p=mod.proveSourceInvariants(input,version);assert.equal(p.status,'failed');assert.equal(p.checks.find(c=>c.id===id)?.passed,false);
});
