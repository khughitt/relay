// Local stand-in for the Anthropic Messages API, for live hook probes: loopback only, no real credentials.
//   node stub-model.mjs PORT LOGDIR SCRIPT.json
// PORT 0 chooses a free port and prints the selected value. Replies are served in order; the last repeats.
// An IPC disconnect (including parent death) closes the server instead of leaving an orphaned stub.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [port, logDir, scriptFile] = process.argv.slice(2);
mkdirSync(logDir, { recursive: true });
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
if (!Array.isArray(script) || script.length === 0) throw new Error('the stub script needs at least one reply');
let n = 0, served = 0;

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function reply(res, body, step) {
  const model = body.model ?? 'stub';
  if (step.error) {
    res.writeHead(step.error, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: step.error === 529 ? 'overloaded_error' : 'api_error', message: 'stub error' } }));
  }
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const message = { id: `msg_stub_${n}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage };
  const block = step.tool ? { type: 'tool_use', id: `toolu_stub_${n}`, name: step.tool, input: {} } : { type: 'text', text: '' };
  const stop = step.tool ? 'tool_use' : 'end_turn';
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...message, content: [step.tool ? { ...block, input: step.input } : { type: 'text', text: step.text }], stop_reason: stop }));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sse(res, 'message_start', { type: 'message_start', message });
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: block });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: step.tool
    ? { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } : { type: 'text_delta', text: step.text } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const i = ++n;
    writeFileSync(join(logDir, `${String(i).padStart(3, '0')}-${req.method}${req.url.replace(/[^A-Za-z0-9]+/g, '_')}.json`), raw || '{}');
    if (req.method === 'POST' && req.url.startsWith('/v1/messages/count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"input_tokens":1}'); }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const internal = !body.tools?.length;
    const step = internal ? { text: 'stub' } : script[Math.min(served++, script.length - 1)];
    reply(res, body, step);
  });
});
server.listen(Number(port), '127.0.0.1', () => process.stdout.write(`listening ${server.address().port}\n`));
process.on('disconnect', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
