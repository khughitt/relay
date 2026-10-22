// Shared contracts for checked JavaScript; this module has no runtime exports.
/**
 * @typedef {'claude-code'|'codex'|'opencode'} Harness
 * @typedef {'idle'|'working'|'needs-input'|'needs-approval'|'done'|'error'} State
 * @typedef {'session-start'|'prompt'|'before-tool'|'activity'|'idle'|'needs-input'|'needs-approval'|'turn-end'|'turn-error'|'session-end'} Kind
 * @typedef {{platform: 'linux'|'darwin', host: string, bootId: string|null, pid: number, start: string}} Handle
 * @typedef {{agents: number, other: number}} Background
 * @typedef {{id: string, harness: Harness, sessionId: string, scope: 'process'|'session'|'worker', root?: string, process: Handle|null, cwd: string, repoRoot: string|null, remote: string|null, projectKey: string, project: string, state: State, updatedAt: number, background?: Background}} Agent
 * @typedef {{schema: 2, generation: string, revision: number, agents: Record<string, Agent>}} Snapshot
 * @typedef {{name: string, input: Record<string, unknown>, command: string|null}} Tool
 * @typedef {{schema: 1, kind: Kind, harness: Harness, nativeEvent: string, agentId: string, sessionId: string, root?: string, cwd: string, stopHookActive?: boolean, background?: Background|null, tool: Tool|null}} Event
 * @typedef {{code: string, message: string, agentId?: string}} Diagnostic
 * @typedef {{snapshot: Snapshot|null, changed: boolean, reaped: string[], diagnostics: Diagnostic[]}} RegistryResult
 * @typedef {{status: 'alive'|'dead'|'unknown', reason: string}} Liveness
 * @typedef {{pid: number, ppid: number, comm: string, tty: string|boolean|null, starttime: string, state: string|null}} ProcessRow
 * @typedef {{clock?: () => number, deadline?: number}} Deadline
 * @typedef {ReturnType<typeof import('./bus/proc.js').createProcessOps>} ProcessOps
 * @typedef {ReturnType<typeof import('./bus/paths.js').paths>} Paths
 * @typedef {{io?: typeof import('node:fs/promises')}} IOOptions
 * @typedef {Deadline & IOOptions & {paths?: Paths, processOps?: ProcessOps, now?: () => number, uuid?: () => string, gitContext?: typeof import('./bus/identity.js').gitContext, resolveSessionPid?: (adapter: Adapter) => number|null}} RegistryOptions
 * @typedef {{refuse: boolean, context: boolean}} Capability
 * @typedef {{decision: 'allow'|'deny', reason?: string, context?: string}} Reply
 * @typedef {{stdout: string, stderr: string, exitCode: number}} Output
 * @typedef {{startPid?: number, ancestors?: (pid: number) => ProcessRow[], executableOf?: (pid: number) => string, argvOf?: (pid: number) => string[]}} AncestryOptions
 * @typedef {{events: Readonly<Record<string, {kind: Kind, level: State|null}>>, replies: Readonly<Record<string, Capability>>, outerTimeouts: Readonly<{default: number, max: Readonly<Record<string, number>>} & Record<string, number|Readonly<Record<string, number>>>>, stateForEvent: (event: string) => State|null, reduceState: (level: State|null, previous?: State|null, context?: {background?: Background}) => State|null, encodeReply: (event: string, reply: Reply) => Output, resolveSessionPid: (options?: AncestryOptions) => number|null, resolveTerminalPid: (options?: AncestryOptions) => number|null, isHarness: (row: ProcessRow, ops: {executableOf: (pid: number) => string}) => boolean, backgroundOf?: (data: Record<string, any>, nativeEvent: string) => Background|null|undefined, workerIdOf?: (data: Record<string, any>, nativeEvent: string) => string|null}} Adapter
 * @typedef {{name: string, role: 'guard'|'observer', kinds: (Kind|'reconcile')[], harnesses: Harness[]|null, tools: string[]|null, argv: string[], timeoutMs: number}} Subscriber
 * @typedef {{schema: 1, subscribers: Subscriber[]}} Subscribers
 * @typedef {{outerMs: number, totalMs: number, inputMs: number, registryMs: number, reserveMs: number, marginMs: number, subscribersMs: number}} Budget
 * @typedef {{status: string, exitCode: number|null, signal: string|null, stdout: string, stderr: string, error?: unknown}} ChildResult
 * @typedef {{kind: 'user', agentId?: never}|{kind: 'agent', agentId: string}} Party
 * @typedef {{project: string|null, taskId: string|null, cwd: string|null}} Context
 * @typedef {{id: string, label: string, description: string|null}} Option
 * @typedef {{id: string, header: string, prompt: string, type: 'boolean'|'single'|'multi'|'text', options: Option[], recommended: string|null, allowOther: boolean, maxLength: number|null}} Item
 * @typedef {{class: 'clarification'|'artifact-review'|'authorization', expiresAt: number, native: {harness: Harness, sessionId: string, callId: string}|null, artifact: {ref: string, revision: string}|null, supersedes: string|null, items: Item[]}} Question
 * @typedef {{type: 'boolean', value: boolean}|{type: 'choice', optionIds: string[]}|{type: 'other'|'text', text: string}} Value
 * @typedef {{answerId: string, surface: string, outcome: 'answered'|'declined', artifactRevision: string|null, values: Record<string, Value>}} Answer
 */
/**
 * @template {string} K
 * @template B
 * @typedef {{schema: 1, id: string, kind: K, correlationId: string, from: Party, to: Party, createdAt: number, context: Context, body: B}} Envelope
 */
/**
 * @typedef {Envelope<'question', Question>} QuestionMessage
 * @typedef {Envelope<'answer', Answer>} AnswerMessage
 * @typedef {Envelope<'defer', {surface: string}>} DeferMessage
 * @typedef {Envelope<'withdrawal', {reason: string}>} WithdrawalMessage
 * @typedef {Envelope<'notice', {expiresAt: number, title: string, text: string, level: 'info'|'warn'}>} NoticeMessage
 * @typedef {QuestionMessage|AnswerMessage|DeferMessage|WithdrawalMessage|NoticeMessage} Message
 * @typedef {'pending'|'answered'|'handed'|'consumed'|'unconfirmed'|'undeliverable'|'released'|'withdrawn'|'expired'} QuestionState
 * @typedef {{seq: number|null, at: number, state: string, cause: string}} LogRow
 * @typedef {{schema: 1, id: string, seq: number|null, updatedAt: number, log: LogRow[]}} EntryFrame
 * @typedef {EntryFrame & {kind: 'question', question: QuestionMessage, state: QuestionState, presentation: 'inbox'|'desktop', route: {handback: boolean, waiter: Handle|null}, answer: AnswerMessage|null, handedAt: number|null, observed: Record<string, string>|null, withdrawal: {reason: string}|null, supersededBy: string|null, messages: {at: number, message: Message}[], observations: {at: number, surface: string, answers: Record<string, string>}[]}} QuestionEntry
 * @typedef {EntryFrame & {kind: 'notice', notice: NoticeMessage, state: 'active'|'expired', seen: boolean}} NoticeEntry
 * @typedef {QuestionEntry|NoticeEntry} Entry
 * @typedef {Entry & {seq: number}} StoredEntry
 * @typedef {{code: string, message?: string, answer?: AnswerMessage|null, revision?: string}} Refusal
 */
/**
 * @template {Entry} [E=Entry]
 * @typedef {{entry: E, changed: boolean, error: Refusal|null}} Result
 */
/**
 * @typedef {{entry: Entry|null, error: Refusal|null, passthrough?: never}|{passthrough: true, entry?: never, error?: never}} InboxResult
 * @typedef {{type: 'entry', entry: Entry}|{type: 'presence', presence: {mode: string, updatedAt: number}}} InboxEvent
 * @typedef {Awaited<ReturnType<typeof import('./serve/inbox.js').openInbox>>['inbox']} Inbox
 * @typedef {Awaited<ReturnType<typeof import('./serve/client.js').connectSocket>>} Connection
 * @typedef {{name: string, value: string, values?: string[], required?: boolean, variadic?: boolean}} Argument
 * @typedef {{names: string[], value: string, values?: string[], required?: boolean}} Flag
 * @typedef {{path: string[], summary: string, options?: Flag[], args?: Argument[], output?: string, protocol?: string}} Command
 * @typedef {{path: string, before: string|null, after: string}} Change
 * @typedef {{schema: 1, harness: string, changes: Change[], evidence: {harness: string, version: string}|null}} Artifact
 * @typedef {{schema: 1, harness: string, version: string, probes: {event: string, reply: string, outerMs: number, passed: boolean}[], routes?: {name: string, passed: boolean, note: string}[]}} Evidence
 * @typedef {{event: string, matcher?: string, outerMs: number, handback?: boolean}} Binding
 * @typedef {{text: string, harness: string, relayBin: string, subscribersPath: string, nodeBin?: string, retireFamiliar?: boolean|string}} HookPlan
 * @typedef {Omit<HookPlan, 'harness'> & {target: string, subscribers: Subscribers, evidence?: Evidence|null, withAsk?: boolean, installedVersion?: string}} InstallPlan
 * @typedef {Error & {code?: string|number, killed?: boolean, signal?: string, stderr?: string, status?: number, entry?: QuestionEntry}} Failure
 */
export {};

/**
 * The private socket is JSON on the wire; callers get an operation's response shape.
 * @typedef {QuestionEntry & {answer: AnswerMessage}} AnsweredEntry
 * @typedef {{ask: {entry: QuestionEntry, passthrough?: false}|{passthrough: true, entry?: never}, handed: {entry: AnsweredEntry}, confirm: {entry: QuestionEntry}, answer: {entry: QuestionEntry}, defer: {entry: QuestionEntry}, withdraw: {entry: QuestionEntry}, notify: {entry: NoticeEntry}, list: {seq: number, entries: StoredEntry[]}, get: {entry: StoredEntry}, 'presence.get': {presence: {mode: string, updatedAt: number}}, 'presence.set': {presence: {mode: string, updatedAt: number}}, watch: {seq: number}}} SocketResponses
 * @typedef {{ok: false, error: Refusal & {message: string}, entry?: Entry|null, passthrough?: never}} SocketFailure
 * @typedef {{type: 'state', entry: QuestionEntry}|InboxEvent} SocketPush
 */
/**
 * @template T
 * @typedef {({ok: true} & T)|SocketFailure} SocketReply
 */
