// @ts-check
import { relayError } from '../protocol.js';
// sockaddr_un's sun_path is 108 bytes on Linux and 104 on Darwin. Linux accepts an unterminated full-length path, but
// relay reserves the terminating NUL so one limit rule holds on both platforms. Past the full length, newer Node fails
// bind and connect with a bare EINVAL and Node 22 silently truncates the path, so serve would bind (and clients reach)
// a different file. relay serve, the bind site and the connect site all refuse first. Only Linux and Darwin are known.
/** @type {Readonly<Record<'linux'|'darwin', number>>} */
export const SOCKET_PATH_LIMITS = Object.freeze({ linux: 107, darwin: 103 });
/** @param {string} socketPath @param {NodeJS.Platform} [platform] @returns {string} */
export function checkSocketPath(socketPath, platform = process.platform) {
  if (platform !== 'linux' && platform !== 'darwin') throw relayError('INVALID_CONFIG', `no service socket path limit is known for platform ${platform}`);
  const limit = SOCKET_PATH_LIMITS[platform], bytes = Buffer.byteLength(socketPath, 'utf8');
  if (bytes > limit) {
    throw relayError('INVALID_CONFIG', `service socket path ${socketPath} is ${bytes} bytes, over the ${limit}-byte ${platform} limit; `
      + 'set a shorter RELAY_STATE_DIR or XDG_STATE_HOME');
  }
  return socketPath;
}
