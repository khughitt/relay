// @ts-check
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
import {connectRpc} from './rpc.js';
import {daemonIdentity} from './identity.js';
import {validateInitialize} from './evidence.js';
import {findProvenance,parseAnswers,callSettled} from './record.js';
import {createReceiptReaders} from './receipts.js';
import {createRequestDelivery} from './delivery.js';
import {toQuestion,callId,nativeAnswers} from '../../routes/codex.js';

/** @param {unknown} id @returns {id is string} */
const validId=id=>typeof id==='string'&&id.length>0&&Buffer.byteLength(id)<=256;
/** @param {any} s */
const waiting=s=>s?.type==='active'&&Array.isArray(s.activeFlags)&&s.activeFlags.includes('waitingOnUserInput');
/** @param {any} s */
const statusProjection=s=>({type:['active','idle','notLoaded','systemError'].includes(s?.type)?s.type:'unknown',activeFlags:waiting(s)?['waitingOnUserInput']:[]});
/** @param {any} value */
const metadataProjection=value=>{const t=value?.thread;return {id:t?.id,cwd:t?.cwd,ephemeral:t?.ephemeral,threadSource:t?.threadSource,status:statusProjection(t?.status)}};
/** @param {any} value */
const resumeProjection=value=>({thread:{id:value?.thread?.id,path:value?.thread?.path},collaborationMode:{mode:value?.collaborationMode?.mode}});
/** @param {any} p */
const tuple=p=>({threadId:p.threadId,turnId:p.turnId,itemId:p.itemId});
/** @param {any} m */
function requestProjection(m) {
  const p=m.params;
  if(![p?.threadId,p?.turnId,p?.itemId].every(validId)||!Array.isArray(p.questions)||p.questions.length>4||p.questions.some((/** @type {any} */ q)=>q?.isSecret!==false))return null;
  return {id:m.id,method:'item/tool/requestUserInput',params:{...tuple(p),isBlocking:p.isBlocking,questions:p.questions.map((/** @type {any} */ q)=>({id:q.id,header:q.header,question:q.question,isOther:q.isOther,isSecret:false,options:Array.isArray(q.options)?q.options.map((/** @type {any} */ o)=>({label:o?.label,description:o?.description})):null}))}};
}
/**
 * Owns every connection, timer and reader. Injected I/O is for isolated IPC tests;
 * service integration uses qualified native identity and the actual transport.
 * @param {{config:import('../../types.js').CodexConfig,inbox:import('../../types.js').Inbox,readAgents:()=>Promise<any>,processOps:import('../../types.js').ProcessOps,signal?:AbortSignal,log?:(code:string)=>void,connect?:typeof connectRpc,identity?:typeof daemonIdentity,pollMs?:number,replayMs?:number,provenanceMs?:number}} options
 */
export async function openCodexConnector({config,inbox,readAgents,processOps,signal,log=()=>{},connect=connectRpc,identity=daemonIdentity,pollMs=1000,replayMs=5000,provenanceMs=5000}) {
  if(pollMs<5||pollMs>1000||replayMs<1||replayMs>5000||provenanceMs<0||provenanceMs>5000)throw Error('CODEX_BOUNDS');
  const lifetime=new AbortController(),abort=()=>lifetime.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const readers=createReceiptReaders({home:config.home});
  /** @type {Map<string,any>} */ const threads=new Map();
  /** @type {Map<string,any>} */ const statuses=new Map();
  /** @type {Set<string>} */ const raced=new Set();
  /** @type {import('../../types.js').Handle|null} */ let generation=null;
  /** @type {import('./rpc.js').Rpc|null} */ let rpc=null;
  /** @type {ReturnType<typeof createRequestDelivery>|null} */ let delivery=null;
  /** @type {AbortController|null} */ let connection=null;
  /** @type {Promise<unknown>} */ let chain=Promise.resolve();
  let revision=0,closed=false,queued=0,queueLimitReported=false;
  const entries=()=>/** @type {(import('../../types.js').QuestionEntry & {route:{handback:true,connector:import('../../types.js').CodexOwner,terminal:boolean}})[]} */ (inbox.retained().filter(e=>e.kind==='question'&&e.route.connector));
  /** @param {()=>Promise<unknown>} fn */
  const enqueue=fn=>{if(queued>=1024){if(!queueLimitReported){queueLimitReported=true;log('CODEX_LIMIT');}connection?.abort();return chain;}queued++;const work=chain.then(fn).finally(()=>{queued--;});chain=work.catch(()=>{if(!closed&&!connection?.signal.aborted){log('CODEX_UNKNOWN');connection?.abort();}});return chain;};
  /** @param {string} id */
  async function row(id) {
    const snapshot=await readAgents();
    return Object.values(snapshot?.agents??{}).find((/** @type {any} */ a)=>a.harness==='codex'&&a.sessionId===id&&a.process&&processOps.probe(a.process).status==='alive');
  }
  /** @param {any} t @param {string} [code] */
  async function release(t,code) {
    t.abort?.abort();if(t.request)delivery?.resolved(t.request.params);
    t.request=null;t.selected=false;
    if(code){const key=JSON.stringify([t.id,t.epoch]);if(!raced.has(key)){if(raced.size>=1000){connection?.abort();return;}raced.add(key);log(code);}}
    if(t.subscribed||t.joining){t.subscribed=false;await rpc?.call('thread/unsubscribe',{threadId:t.id});}
  }
  /** @param {any} old */
  async function gone(old) {
    for(const e of entries())if(callId(e.route.connector.tuple)===callId(old)&&isDeepStrictEqual(e.route.connector.generationBinding,generation))await inbox.codexGone(e.id,e.route.connector,'superseded');
  }
  /** @param {any} t @param {any} request */
  async function admit(t,request) {
    if(!t.selected||!t.record||t.request!==request||t.abort.signal.aborted)return;
    const p=request.params,old=entries().find((/** @type {any} */ e)=>callId(e.route.connector.tuple)===callId(p));
    if(old&&(!isDeepStrictEqual(old.route.connector.generationBinding,generation)||!['pending','answered','handed','unconfirmed'].includes(old.state))){await release(t,'CODEX_JOIN_RACED');return;}
    const provenance=await findProvenance(t.record,p.itemId,{signal:t.abort.signal,waitMs:provenanceMs});
    if(provenance!=='built-in'||t.mode!=='plan'||!waiting(statuses.get(t.id)?.status)){await release(t,'CODEX_JOIN_RACED');return;}
    const a=await row(t.id);if(!a||!t.selected||t.abort.signal.aborted)return;
    if(!old&&inbox.presence().mode!=='away'){await release(t);return;}
    const message=toQuestion(p,{id:old?.id??randomUUID(),now:old?.question.createdAt??Date.now(),agentId:a.id,cwd:t.cwd,project:a.project});
    const owner={kind:/** @type {const} */ ('codex'),tuple:tuple(p),generationBinding:/** @type {import('../../types.js').Handle} */ (generation),items:p.questions.map((/** @type {any} */ q,/** @type {number} */ i)=>({relayId:`q${i+1}`,nativeId:q.id})),...(old?(old.route.connector.rolloutPath?{rolloutPath:old.route.connector.rolloutPath}:{}):{rolloutPath:t.recordPath})};
    if(old?.route.connector.rolloutPath&&old.route.connector.rolloutPath!==t.recordPath){await release(t,'CODEX_JOIN_RACED');return;}
    if(old&&(!isDeepStrictEqual(old.question,message)||!isDeepStrictEqual(old.route.connector,owner))){await release(t,'CODEX_JOIN_RACED');return;}
    await delivery?.admit(p,true);
    if(!old){const r=await inbox.codexAsk(message,owner);if(r.error)throw Error('CODEX_STORE');}
    t.entryId=message.id;
    await drain(message.id);if(old?.state==='unconfirmed')await release(t);
  }
  /** @param {string} id */
  async function drain(id) {
    const e=entries().find(e=>e.id===id);if(!e||!['answered','handed'].includes(e.state)||!e.answer)return;
    const t=threads.get(e.route.connector.tuple.threadId);
    if(!t?.selected||!t.request||t.abort.signal.aborted||callId(t.request.params)!==callId(e.route.connector.tuple)||!isDeepStrictEqual(e.route.connector.generationBinding,generation)||e.route.terminal||t.sentId===e.answer.body.answerId)return;
    const body=nativeAnswers(e.question,e.answer.body,e.route.connector.items);
    const handed=await inbox.codexHanded(e.id,e.route.connector);if(handed.error||handed.entry?.state!=='handed')return;
    try{await delivery?.sendAnswer(t.request.params,body,()=>{
      const latest=entries().find(x=>x.id===id);
      if(!latest||latest.state!=='handed'||latest.route.terminal||latest.answer?.body.answerId!==e.answer?.body.answerId||Date.now()>=latest.question.body.expiresAt||t.abort.signal.aborted||!t.selected)throw Error('revoked');
    });t.sentId=e.answer.body.answerId;}catch{if(rpc?.error)connection?.abort();}
  }
  async function reconcile() {
    const paths=new Set();
    for(const e of entries()) {
      if(e.state==='consumed'||e.route.terminal&&e.observed!==null&&['released','withdrawn','undeliverable','expired'].includes(e.state))continue;
      const owner=e.route.connector,t=threads.get(owner.tuple.threadId),path=owner.rolloutPath??t?.recordPath;
      if(typeof path!=='string')continue;paths.add(path);
      const snapshot=await readers.get(path).read();
      const terminal=e.route.terminal;
      if(snapshot.state!=='ok')continue;
      const answers=/** @type {import('../../types.js').CodexAnswers|null} */ (parseAnswers(snapshot.outputs.get(owner.tuple.itemId)));
      if(answers!==null)await inbox.codexObserve(e.id,owner,{answers,terminal});
      else if(terminal) {
        const settled=callSettled(snapshot,owner.tuple,{request:{method:'item/tool/requestUserInput',params:owner.tuple},terminalObserved:terminal});
        if(settled==='no-answer'||settled==='gone')await inbox.codexGone(e.id,owner,settled==='gone'?'disappeared':'no-answer');
      }
      await drain(e.id);
    }
    for(const t of threads.values())if(t.selected&&t.recordPath)paths.add(t.recordPath);
    await readers.prune(paths);
  }
  /** @param {any} m */
  function receive(m) {
    const p=m.params;
    if(m.method==='thread/started') {
      const id=p?.thread?.id;if(!validId(id))return;
      const t=threads.get(id);
      if(!t?.selected&&!t?.joining)void rpc?.call('thread/unsubscribe',{threadId:id}).catch(()=>connection?.abort());
      return;
    }
    const id=p?.threadId;if(!validId(id))return;
    if(m.method==='thread/status/changed') {
      if(!statuses.has(id)&&statuses.size>=1000){connection?.abort();return;}
      const previous=statuses.get(id),isWaiting=waiting(p.status);
      const status=statusProjection(p.status);
      statuses.set(id,{status,revision:++revision,epoch:(previous?.epoch??0)+(isWaiting&&!waiting(previous?.status)?1:0)});
      const t=threads.get(id);
      if(t&&!isWaiting){t.abort?.abort();if(t.request)delivery?.resolved(t.request.params);if(status.type==='idle'||status.type==='notLoaded')void enqueue(()=>release(t));}
      return;
    }
    const t=threads.get(id);
    if(m.method==='turn/completed'&&validId(p.turn?.id)&&['completed','interrupted','failed'].includes(p.turn.status)) {
      const ended=entries().filter(e=>e.route.connector.tuple.threadId===id&&e.route.connector.tuple.turnId===p.turn.id&&isDeepStrictEqual(e.route.connector.generationBinding,generation)).map(e=>({id:e.id,owner:e.route.connector}));
      if(ended.length===0)return;
      if(t?.request?.params.turnId===p.turn.id){delivery?.resolved(t.request.params);t.abort?.abort();}
      const ownsCurrent=t&&(t.request?.params.turnId===p.turn.id||!t.selected&&!t.joining);
      void enqueue(async()=>{for(const e of ended)await inbox.codexObserve(e.id,e.owner,{answers:null,terminal:true});await reconcile();if(ownsCurrent)await release(t);});return;
    }
    if(!t?.selected&&!t?.joining)return;
    if(m.method==='item/tool/requestUserInput') {
      const old=t.request;
      if(old&&(!validId(p.turnId)||!validId(p.itemId)||callId(old.params)!==callId(p))){delivery?.resolved(old.params);t.abort?.abort();if(validId(p.turnId)&&validId(p.itemId)&&p.turnId===old.params.turnId)void enqueue(()=>gone(old.params));}
      if(!validId(p.turnId)||!validId(p.itemId)||!(validId(m.id)||Number.isSafeInteger(m.id))){if(old)delivery?.resolved(old.params);t.abort?.abort();connection?.abort();return;}
      const projected=requestProjection(m);
      if(!projected){if(old){delivery?.resolved(old.params);t.abort?.abort();}t.request=null;void enqueue(()=>release(t));return;}
      if(old&&callId(old.params)===callId(projected.params)&&!isDeepStrictEqual(old.params,projected.params)){delivery?.resolved(old.params);t.abort?.abort();t.request=null;connection?.abort();return;}
      try{toQuestion(projected.params,{id:randomUUID(),now:Date.now(),agentId:'codex:'+id,cwd:t.cwd??'/'});}catch{t.request=null;void enqueue(()=>release(t));return;}
      if(old&&callId(old.params)===callId(projected.params)&&isDeepStrictEqual(old.params,projected.params)) {
        old.id=projected.id;void delivery?.observe(old).catch(()=>connection?.abort());if(t.joining)t.replayed?.();return;
      }
      t.abort=new AbortController();t.request=projected;
      void delivery?.observe(projected).catch(()=>connection?.abort());
      if(t.joining){t.replayed?.();return;}
      void enqueue(()=>admit(t,projected));return;
    }
    if(m.method==='serverRequest/resolved'&&t.request?.id===p.requestId){delivery?.resolved(t.request.params);t.abort?.abort();return;}
  }
  /** @param {string} id */
  async function discover(id) {
    const existing=threads.get(id);if(existing?.selected||existing?.joining)return;
    if(inbox.presence().mode!=='away'&&!entries().some((/** @type {any} */ e)=>e.route.connector.tuple.threadId===id&&['pending','answered','handed'].includes(e.state)))return;
    const a=await row(id);if(!a)return;
    const version=statuses.get(id)?.revision;
    const metadata=metadataProjection(await rpc?.call('thread/read',{threadId:id,includeTurns:false}));
    if(!metadata||metadata.id!==id||typeof metadata.ephemeral!=='boolean'||typeof metadata.threadSource!=='string'||typeof metadata.cwd!=='string'||Buffer.byteLength(metadata.cwd)>4096||Buffer.byteLength(metadata.threadSource)>256)return;
    if(metadata.ephemeral&&['system','thread_title'].includes(metadata.threadSource))return;
    if(statuses.get(id)?.revision===version){const prior=statuses.get(id);statuses.set(id,{status:{type:metadata.status?.type,activeFlags:waiting(metadata.status)?['waitingOnUserInput']:[]},epoch:(prior?.epoch??0)+(waiting(metadata.status)&&!waiting(prior?.status)?1:0),revision:++revision});}
    const observed=statuses.get(id);if(!waiting(observed?.status))return;
    const key=JSON.stringify([id,observed.epoch]);if(raced.has(key))return;
    const latest=await row(id);if(!latest||!waiting(statuses.get(id)?.status)||statuses.get(id)?.epoch!==observed.epoch)return;
    if(threads.size>=1000&&!existing){connection?.abort();return;}
    const t=existing??{id};Object.assign(t,{joining:true,selected:false,subscribed:false,epoch:observed.epoch,cwd:metadata.cwd,request:null,sentId:null});threads.set(id,t);
    let resolveReplay=()=>{};const replayed=new Promise(/** @param {(value?:unknown)=>void} resolve */ resolve=>{resolveReplay=resolve});t.replayed=resolveReplay;
    try {
      const resumed=resumeProjection(await rpc?.call('thread/resume',{threadId:id,excludeTurns:true},()=>{
        if(connection?.signal.aborted||!waiting(statuses.get(id)?.status)||statuses.get(id)?.epoch!==t.epoch||processOps.probe(latest.process).status!=='alive'||inbox.presence().mode!=='away'&&!entries().some((/** @type {any} */ e)=>e.route.connector.tuple.threadId===id&&['pending','answered','handed'].includes(e.state)))throw Error('revoked');
      }));
      t.subscribed=true;
      if(!t.request)await Promise.race([replayed,pause(replayMs,undefined,{signal:connection?.signal})]);
      if(!t.request||!waiting(statuses.get(id)?.status)||statuses.get(id)?.epoch!==t.epoch){await release(t,'CODEX_JOIN_RACED');return;}
      const known=entries().filter((/** @type {any} */ e)=>e.route.connector.tuple.threadId===id&&['pending','answered','handed'].includes(e.state)&&!e.route.terminal);
      if(known.some((/** @type {any} */ e)=>callId(e.route.connector.tuple)!==callId(t.request.params))){await release(t,'CODEX_JOIN_RACED');return;}
      if(!resumed?.thread?.path||resumed.thread.id!==id||resumed.collaborationMode?.mode!=='plan'){await release(t,'CODEX_JOIN_RACED');return;}
      t.recordPath=resumed.thread.path;t.record=readers.get(t.recordPath);
      t.mode='plan';t.selected=true;await admit(t,t.request);
    } catch {if(!connection?.signal.aborted)await release(t,'CODEX_JOIN_RACED');}
    finally{t.joining=false;t.replayed=null;}
  }
  async function refresh() {
    const ids=[],cursors=new Set();let cursor;
    for(let page=0;page<100;page++) {
      /** @type {any} */ const result=await rpc?.call('thread/loaded/list',{limit:100,...(cursor?{cursor}:{})});
      if(!Array.isArray(result?.data)||result.data.some((/** @type {any} */ id)=>!validId(id))||ids.length+result.data.length>1000)throw Error('CODEX_DISCOVERY');
      ids.push(...result.data);if(result.nextCursor===null){for(const id of new Set(ids))await discover(id);return;}
      if(!validId(result.nextCursor)||cursors.has(result.nextCursor))throw Error('CODEX_DISCOVERY');cursors.add(result.nextCursor);cursor=result.nextCursor;
    }
    throw Error('CODEX_DISCOVERY');
  }
  async function run() {
    let backoff=1000;
    while(!lifetime.signal.aborted) {
      connection=new AbortController();const stop=()=>connection?.abort();lifetime.signal.addEventListener('abort',stop,{once:true});
      try {
        const found=await identity(config,processOps);if(!found)throw Error('CODEX_IDENTITY');
        for(const e of entries())if(!isDeepStrictEqual(e.route.connector.generationBinding,found))await inbox.codexGone(e.id,e.route.connector,'replacement');
        generation=found;
        rpc=await connect({socketPath:config.socket,signal:connection.signal,onMessage:receive,onFailure:()=>connection?.abort()});
        delivery=createRequestDelivery({send:(m,beforeWrite)=>/** @type {import('./rpc.js').Rpc} */ (rpc).send(m,()=>{if(connection?.signal.aborted||!generation||processOps.probe(generation).status!=='alive')throw Error('revoked');beforeWrite();}),onSuperseded:gone});
        validateInitialize(await rpc.call('initialize',{clientInfo:{name:'relay-question-connector',version:'1'},capabilities:{experimentalApi:true}}),config);
        await rpc.send({method:'initialized'});backoff=1000;
        while(!connection.signal.aborted) {
          const current=await identity(config,processOps);if(!isDeepStrictEqual(current,generation))throw Error('CODEX_IDENTITY');
          await enqueue(async()=>{await refresh();await reconcile();});await pause(pollMs,undefined,{signal:connection.signal});
        }
      }catch{if(!closed&&!lifetime.signal.aborted)log('CODEX_CONNECTION');}
      finally {
        lifetime.signal.removeEventListener('abort',stop);connection.abort();delivery?.close();await rpc?.close();
        for(const t of threads.values()){t.abort?.abort();t.selected=false;t.joining=false;t.subscribed=false;t.request=null;t.sentId=null;t.record=null;}
        await chain;rpc=null;delivery=null;
      }
      if(!lifetime.signal.aborted)try{await pause(backoff,undefined,{signal:lifetime.signal});backoff=Math.min(30000,backoff*2);}catch{}
    }
  }
  const unsubscribe=inbox.subscribe(event=>{
    if(event.type==='entry'&&event.entry.kind==='question'&&event.entry.route.connector) {
      const entry=event.entry,owner=entry.route.connector;if(!owner)return;const t=threads.get(owner.tuple.threadId);
      if(!['pending','answered','handed'].includes(entry.state)&&t?.request&&callId(t.request.params)===callId(owner.tuple)){delivery?.resolved(t.request.params);t.abort?.abort();}
      void enqueue(()=>drain(entry.id));
    }
  });
  const observer=setInterval(()=>{if(!closed)void enqueue(reconcile);},pollMs);
  const running=run();
  return {idle:()=>chain,async close(){if(closed)return running;closed=true;clearInterval(observer);unsubscribe();lifetime.abort();connection?.abort();await running;await chain;await readers.close();signal?.removeEventListener('abort',abort);threads.clear();statuses.clear();raced.clear();}};
}
