import { isAbsolute } from 'node:path';
import { relayError } from '../protocol.js';
const invalid = (message) => { throw relayError('INVALID_CONFIG', message); };
export function serveConfig(env) {
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
    return { http: null };
  }
  if (typeof port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) invalid('RELAY_HTTP_PORT must be a port number');
  return { http: { port: Number(port), serveHost: host ?? null, serveLogin: login ?? null, clientDir: clientDir ?? null } };
}
