// @ts-check
// Nearest-rank quantiles (index ceil(p*n)-1 of the sorted samples), no outlier removal.
/** @param {number[]} samples @returns {{count: number, p50: number, p95: number, p99: number, max: number}} */
export function statistics(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('statistics need a nonempty list of finite numbers');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  /** @param {number} p */
  const rank = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return { count: sorted.length, p50: rank(0.5), p95: rank(0.95), p99: rank(0.99), max: sorted[sorted.length - 1] };
}
