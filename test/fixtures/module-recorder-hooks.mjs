import { appendFileSync } from 'node:fs';
let log;
export function initialize(data) { log = data.log; }
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (log) appendFileSync(log, `${result.url}\n`);
  return result;
}
