import {createHash} from 'node:crypto';

export const ARCHIVES={
 '0.165.0':'4e066a7dbd1234efa7458c2b137161bb7ddde1dde6be4ed4c8f38e6c45f862ab',
 '0.166.0':'718c86dcd7104919f2820aa79db0fa0083b5f240aa16da704f43e4acf7b544e5'
};
export const ADDITIONAL_SOURCES=['core/src/context_manager/history.rs','rollout/src/policy.rs'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// These lexical checks accompany an exact archive pin and review of every changed source.
const tokens=/b?r(#+)"[\s\S]*?"\1|b?r"[\s\S]*?"|b?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const blank=s=>s.replace(/[^\n]/g,' ');
const comments=s=>s.replace(tokens,m=>m.startsWith('/')?blank(m):m);
function block(text,needle){
 const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),anchor=new RegExp('^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?'+escaped+'\\b','m').exec(text);
 if(!anchor)throw Error('source-anchor');text=text.slice(anchor.index);
 const masked=text.replace(tokens,blank),at=0,begin=masked.indexOf('{');if(begin<0)throw Error('source-block');
 let depth=0;for(let i=begin;i<masked.length;i++){if(masked[i]==='{')depth++;if(masked[i]==='}'&&--depth===0)return comments(text.slice(at,i+1));}
 throw Error('source-block');
}
const all=(text,...patterns)=>patterns.every(p=>p.test(text));
export function proveSourceInvariants(files,version){
 const checks=[],known=Object.hasOwn(ARCHIVES,version);
 const source=file=>{const text=files[file];if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw Error('source-file');return comments(text)};
 const fn=(file,name)=>block(source(file),'fn '+name);
 const check=(id,names,prove)=>{let passed=false;try{passed=known&&prove()}catch{}checks.push({id,files:names,passed:!!passed})};
 const handler='core/src/tools/handlers/request_user_input.rs',parallel='core/src/tools/parallel.rs',context='core/src/tools/context.rs',session='core/src/session/mod.rs',state='core/src/state/turn.rs',events='app-server/src/bespoke_event_handling.rs',lifecycle='app-server/src/request_processors/thread_lifecycle.rs',status='app-server/src/thread_status.rs',outgoing='app-server/src/outgoing_message.rs',processor='app-server/src/request_processors/thread_processor.rs';
 check('builtin-answer-map',[handler],()=>{const s=fn(handler,'handle_call');return all(s,/is_blocking:\s*mode == ModeKind::Plan/,/let content = serde_json::to_string\(&response\)/,/Ok\(boxed_tool_output\(FunctionToolOutput::from_text\(\s*content,\s*Some\(true\)/)&&s.split('Ok(boxed_tool_output').length===2&&!source(handler).includes('fn supports_parallel_tool_calls')});
 check('serial-default',['tools/src/tool_executor.rs'],()=>/\{\s*false\s*\}$/.test(fn('tools/src/tool_executor.rs','supports_parallel_tool_calls')));
 check('serial-runtime',[parallel,'core/src/tools/router.rs'],()=>all(source(parallel),/let supports_parallel = router.tool_supports_parallel\(&call\)/,/if supports_parallel\s*\{[\s\S]*?lock.read\(\)[\s\S]*?\}\s*else\s*\{[\s\S]*?lock.write\(\)/)&&/supports_parallel_tool_calls/.test(fn('core/src/tools/router.rs','tool_supports_parallel')));
 check('turn-slot',[session,state],()=>all(fn(session,'request_user_input'),/let sub_id = turn_context.sub_id.clone\(\)/,/ts.insert_pending_user_input\(sub_id, tx_response\)/,/turn_id: turn_context.sub_id.clone\(\)/,/rx_response.await.ok\(\)/)&&/self.pending_user_input.insert\(key, tx\)/.test(fn(state,'insert_pending_user_input')));
 check('decline-collisions',[events],()=>{const s=fn(events,'on_request_user_input_response');return (s.match(/answers:\s*HashMap::new\(\)/g)??[]).length===3&&all(s,/is_turn_transition_server_request_error\(&err\) => return/,/serde_json::from_value::<ToolRequestUserInputResponse>/,/id: event_turn_id/)});
 check('string-output',[context],()=>all(fn(context,'function_tool_response'),/\[FunctionCallOutputContentItem::InputText \{ text \}\] =>\s*\{\s*FunctionCallOutputBody::Text\(text.clone\(\)\)/)&&all(block(source(context),'impl ToolOutput for AbortedToolOutput'),/function_tool_response\(/,/InputText \{\s*text: self.message.clone\(\)/));
 check('abort-output',[parallel],()=>all(fn(parallel,'abort_message'),/aborted before dispatch/,/aborted by user after/)&&/AbortedToolOutput/.test(fn(parallel,'aborted_response'))&&all(fn(parallel,'failure_response'),/FunctionCallOutputBody::Text\(message\)/,/success: Some\(false\)/));
 check('status-broadcast',[status,outgoing],()=>all(fn(status,'mutate_and_publish'),/send_server_notification\(ServerNotification::ThreadStatusChanged\(notification\)\)/)&&all(source(outgoing),/send_server_notification_to_connections\(&\[\], notification\)/,/if connection_ids.is_empty\(\)\s*\{[\s\S]*?OutgoingEnvelope::Broadcast/));
 check('waiting-status',[status],()=>all(fn(status,'loaded_thread_status'),/if runtime.pending_user_input_requests > 0\s*\{\s*active_flags.push\(ThreadActiveFlag::WaitingOnUserInput\)/,/if runtime.running \|\| !active_flags.is_empty\(\)\s*\{\s*return ThreadStatus::Active/));
 check('resume-replay',[lifecycle,outgoing],()=>all(source(lifecycle),/collaboration_mode: Some\(collaboration_mode\)/,/replay_requests_to_connection_for_thread\(connection_id, conversation_id\)/)&&all(fn(outgoing,'replay_requests_to_connection_for_thread'),/pending_requests_for_thread\(thread_id\)/,/OutgoingMessage::Request\(request\)/));
 check('unload-conditions',[lifecycle],()=>all(fn(lifecycle,'unloading_target'),/\(\(false, has_no_subscribers_since\), \(false, is_inactive_since\)\)/,/std::cmp::max\(has_no_subscribers_since, is_inactive_since\).checked_add\(self.delay\)/));
 const expected=version==='0.165.0'?1800:60;
 check('unload-default',['core/src/config/mod.rs'],()=>new RegExp('cfg\\.thread_unload_delay_secs\\.unwrap_or\\(\\s*'+expected+'\\)').test(source('core/src/config/mod.rs')));
 check('helper-set',['tui/src/app/app_server_events.rs','tui/src/temporary_structured_request.rs','tui/src/app/thread_title.rs'],()=>all(source('tui/src/app/app_server_events.rs'),/&& started.thread.ephemeral/,/ThreadSource::Feature\(feature\).*"system" \| "thread_title"/)&&all(source('tui/src/temporary_structured_request.rs'),/ephemeral: Some\(true\)/,/dynamic_tools: Some\(Vec::new\(\)\)/,/"tools.experimental_request_user_input.enabled".to_string\(\),\s*false.into\(\)/)&&/ThreadSource::Feature\("thread_title".to_string\(\)\)/.test(source('tui/src/app/thread_title.rs')));
 check('pid-identity',['app-server-daemon/src/backend/pid.rs','app-server-daemon/src/backend/pid_identity.rs','app-server-daemon/src/lib.rs'],()=>all(block(source('app-server-daemon/src/backend/pid.rs'),'struct PidRecord'),/pid: u32/,/process_start_time: String/,/process_identity: Option<identity::ProcessIdentity>/)&&all(source('app-server-daemon/src/backend/pid_identity.rs'),/rename_all_fields = "camelCase"/,/boot_id: String/,/start_ticks: u64/)&&/app-server.pid/.test(source('app-server-daemon/src/lib.rs')));
 check('resume-residual',[processor,'app-server-protocol/src/protocol/v2/thread.rs'],()=>all(fn(processor,'thread_resume_inner'),/RunningThreadResumeResult::NotRunning/,/\.start_thread\(/)&&!/loaded_only|loadedOnly/.test(block(source('app-server-protocol/src/protocol/v2/thread.rs'),'struct ThreadResumeParams')));
 check('raw-rollout',['rollout/src/policy.rs'],()=>{const s=fn('rollout/src/policy.rs','should_persist_response_item');return all(s,/ResponseItem::FunctionCallOutput/,/ResponseItem::CustomToolCallOutput/)&&s.indexOf('ResponseItem::FunctionCallOutput')<s.indexOf('=> true')&&s.indexOf('ResponseItem::CustomToolCallOutput')<s.indexOf('=> true')});
 check('synthetic-history',['core/src/context_manager/history.rs','core/src/context_manager/normalize.rs'],()=>all(fn('core/src/context_manager/history.rs','for_prompt_annotated'),/mut self/,/self.normalize_history\(input_modalities\)/)&&/ensure_call_outputs_present/.test(fn('core/src/context_manager/history.rs','normalize_history'))&&/FunctionCallOutputPayload::from_text\("aborted".to_string\(\)\)/.test(source('core/src/context_manager/normalize.rs')));
 const passed=checks.every(c=>c.passed);
 return {schema:1,version,status:passed?'passed':'failed',checks,facts:{unloadDefaultSeconds:checks.find(c=>c.id==='unload-default').passed?expected:null},evidenceKind:'pinned-source-lexical-invariants-and-changed-source-review'};
}
