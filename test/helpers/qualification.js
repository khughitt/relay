// Builds HookQualification documents for tests: every check a route requires is passed with
// evidence, and every check its role/event rule exempts is not-applicable.
import { applicableChecks, QUALIFICATION_CHECKS, requiredRoutes } from '../../src/install/qualification.js';
import { bindingsFor } from '../../src/install/hooks.js';

export const COMMIT = 'a'.repeat(40);
export const DIGEST = 'b'.repeat(64);

/** @param {string} harness @param {{event: string, role: string, outerMs?: number}} route */
export function passedChecks(harness, route) {
  const required = applicableChecks(harness, route);
  return Object.fromEntries(QUALIFICATION_CHECKS.map((check) => [check, !required.includes(check) ? { status: 'not-applicable', evidence: [] }
    : check === 'latency' ? { status: 'passed', evidence: [`host=host-a outerMs=${Math.min(20000, route.outerMs ?? 20000)} ${route.event} p95 within bound at ${COMMIT}`, `host=host-b outerMs=${Math.min(20000, route.outerMs ?? 20000)} ${route.event} p95 within bound at ${COMMIT}`] }
      : { status: 'passed', evidence: [`fixture ${check} ${harness} ${route.event} at ${COMMIT}`] }]));
}

/** @param {{harness: string, version: string, sessionMode?: string, platform?: string, relayCommit?: string, configDigest?: string,
 *   routes: {event: string, role: string, outerMs: number, contextLimit?: number}[]}} options */
export function qualificationFor({ harness, version, sessionMode = 'interactive', platform = process.platform, relayCommit = COMMIT, configDigest = DIGEST, routes }) {
  return { schema: 1, harness, version, sessionMode, platform, relayCommit, configDigest,
    rows: routes.map((route) => ({ ...route, ...passedChecks(harness, route) })) };
}

/** Registry-only rows (no subscribers match) for every binding given. @param {{event: string, outerMs: number}[]} bindings */
export const registryRoutes = (bindings) => bindings.map(({ event, outerMs }) => ({ event, role: 'registry', outerMs }));

export const VERSIONS = Object.freeze({ 'claude-code': '2.1.296', codex: '0.167.2' });
/**
 * A passing qualification and its matching installation identity for the routes these bindings
 * install with these subscribers (a guard or notice row carries relay's own context limit).
 * @param {string} harness @param {any} subscribers @param {{bindings?: any[], version?: string, configDigest?: string}} [options]
 */
export function qualifiedInstall(harness, subscribers, { bindings = bindingsFor(harness), version = VERSIONS[harness], configDigest = DIGEST } = {}) {
  const routes = requiredRoutes({ harness, subscribers, bindings }).map((route) => (route.role === 'guard' || route.role === 'notice' ? { ...route, contextLimit: 10000 } : route));
  return { qualification: qualificationFor({ harness, version, configDigest, routes }),
    identity: { harness, version, mode: 'interactive', platform: process.platform, relayCommit: COMMIT, configDigest } };
}
