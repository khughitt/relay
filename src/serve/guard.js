// @ts-check
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/;
// Any proxy marker requires the configured tailnet identity, including on static paths.
/** @param {import("node:http").IncomingHttpHeaders} headers @param {{port: number, serveHost: string|null, serveLogin: string|null}} config */
export function classify(headers, { port, serveHost, serveLogin }) {
  const proxied = Object.keys(headers).some((name) => name.startsWith('x-forwarded-')
    || name === 'tailscale-user-login' || name === 'tailscale-funnel-request');
  if (proxied) {
    if (!serveHost || !serveLogin || headers['tailscale-funnel-request'] !== undefined
      || headers['tailscale-user-login'] !== serveLogin || headers.host !== serveHost) return { allowed: false };
    return { allowed: true, surface: 'phone', origin: `https://${serveHost}` };
  }
  const m = LOOPBACK.exec(headers.host ?? '');
  if (!m || Number(m[2]) !== port) return { allowed: false };
  return { allowed: true, surface: 'desktop', origin: `http://${headers.host}` };
}
