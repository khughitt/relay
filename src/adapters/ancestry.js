// Two lookups over one nearest-first ancestor chain whose index zero is the hook itself.
// The session process is the registry's identity handle: the harness process that fired the
// hook, terminal or not. The terminal process is where a presentation layer paints: the
// measured familiar predicate. They coincide for an interactive session and differ for every
// session without a terminal of its own. Spec: docs/specs/2026-09-23-session-process-handle.md.
export const VERSION_COMM = /^[0-9]+(\.[0-9]+)+$/;
// The walk never continues past the nearest harness process: a pid borrowed from an outer
// session is worse than none.
export function nearestSessionPid(chain, { isHarness, roles = [], argvOf }) {
  const nearest = chain.find((row, index) => index > 0 && isHarness(row));
  if (!nearest) return null;
  if (roles.length > 0 && roles.includes(argvOf(nearest.pid)[1])) return null;
  return nearest.pid;
}
export function nearestTerminalPid(chain, comm) {
  return chain.find((row, index) => index > 0 && row.comm === comm && row.tty !== null)?.pid ?? null;
}
