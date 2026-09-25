import { readFileSync } from 'node:fs';
// Redaction for results that leave the Mac. Numbers, booleans and null are never altered:
// every fact that depends on a raw string (lengths, absoluteness, equality) is recorded as
// one of those at capture time, so a verdict never depends on redacted text.
const HOST_KEYS = ['os', 'HostName', 'LocalHostName', 'ComputerName'];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function collectHosts(results) {
  const seen = [], add = (v) => { if (typeof v === 'string' && v && !seen.includes(v)) seen.push(v); };
  const hosts = results.stages.D0?.observations?.hosts ?? {};
  for (const when of ['start', 'end']) for (const key of HOST_KEYS) add(hosts[when]?.[key]);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'host') add(x); walk(x); }
  };
  for (const id of Object.keys(results.stages).sort()) walk(results.stages[id]);
  return seen;
}
export function redactionMap({ hosts, user, home }) {
  return { hosts: new Map(hosts.map((h, i) => [h, `<host-${i + 1}>`])), user, home };
}
export function redactText(text, map) {
  const counts = { host: 0, user: 0, home: 0 };
  let out = text;
  if (map.home) out = out.replace(new RegExp(escape(map.home), 'g'), () => { counts.home++; return map.home.replace(/[^/]+$/, '<user>'); });
  for (const host of [...map.hosts.keys()].sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(escape(host), 'g'), () => { counts.host++; return map.hosts.get(host); });
  if (map.user) out = out.replace(new RegExp(`(?<![A-Za-z0-9_<-])${escape(map.user)}(?![A-Za-z0-9_>-])`, 'g'), () => { counts.user++; return '<user>'; });
  return { text: out, counts };
}
export function redactValue(value, map, counts) {
  if (typeof value === 'string') {
    const r = redactText(value, map);
    for (const k of Object.keys(counts)) counts[k] += r.counts[k];
    return r.text;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, map, counts));
  // Keys are schema (check ids, agent ids, field names), never host or user text.
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, map, counts)]));
  return value;
}
export function redactFile(path, map) {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.json')) return redactText(text, map);
  const counts = { host: 0, user: 0, home: 0 };
  return { text: `${JSON.stringify(redactValue(JSON.parse(text), map, counts), null, 2)}\n`, counts };
}
