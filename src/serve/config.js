// @ts-check
import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';
/** @type {(message: string) => never} */
const invalid = (message) => { throw relayError('INVALID_CONFIG', message); };
/** @param {NodeJS.ProcessEnv} env */
export function serveConfig(env) {
  const fields=['RELAY_CODEX_BIN','RELAY_CODEX_HOME','RELAY_CODEX_SOCKET','RELAY_CODEX_EVIDENCE'];
  const configured=fields.some(k=>env[k]!==undefined);
  /** @type {import('../types.js').CodexConfig|null} */ let codex=null;
  if(configured){
    if(fields.some(k=>typeof env[k]!=='string'||!env[k]||env[k]?.includes('\0')||!isAbsolute(/** @type {string} */ (env[k]))))invalid('all four RELAY_CODEX paths must be absolute');
    if(Buffer.byteLength(/** @type {string} */ (env.RELAY_CODEX_SOCKET))>103)invalid('RELAY_CODEX_SOCKET is too long');
    codex={bin:/** @type {string} */ (env.RELAY_CODEX_BIN),home:/** @type {string} */ (env.RELAY_CODEX_HOME),socket:/** @type {string} */ (env.RELAY_CODEX_SOCKET),evidence:/** @type {string} */ (env.RELAY_CODEX_EVIDENCE)};
  }
  const { RELAY_HTTP_PORT: port, RELAY_SERVE_HOST: host, RELAY_SERVE_LOGIN: login, RELAY_CLIENT_DIR: clientDir } = env;
  if ((host === undefined) !== (login === undefined)) invalid(`${host === undefined ? 'RELAY_SERVE_HOST' : 'RELAY_SERVE_LOGIN'} is required when ${host === undefined ? 'RELAY_SERVE_LOGIN' : 'RELAY_SERVE_HOST'} is set`);
  if (host !== undefined) {
    const authority = typeof host === 'string' && /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::([1-9][0-9]{0,4}))?$/.exec(host);
    if (!authority || (authority[2] && Number(authority[2]) > 65535)) invalid('RELAY_SERVE_HOST must be a host with an optional port');
    if (typeof login !== 'string' || !login || /\s/.test(login)) invalid('RELAY_SERVE_LOGIN must be a nonempty login');
  }
  if (clientDir !== undefined && (typeof clientDir !== 'string' || !isAbsolute(clientDir))) invalid('RELAY_CLIENT_DIR must be absolute');
  if (port === undefined) {
    if (host !== undefined || login !== undefined || clientDir !== undefined) invalid('RELAY_SERVE_HOST, RELAY_SERVE_LOGIN and RELAY_CLIENT_DIR need RELAY_HTTP_PORT');
    return { http: null, codex };
  }
  if (typeof port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) invalid('RELAY_HTTP_PORT must be a port number');
  return { codex, http: { port: Number(port), serveHost: host ?? null, serveLogin: login ?? null, clientDir: clientDir ?? null } };
}
