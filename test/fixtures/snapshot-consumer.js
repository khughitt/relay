// A sample snapshot-derived consumer, the shape docs/registry.md recommends: applications are
// serialized; within one generation only a newer revision applies; a changed generation is adopted
// only from an authoritative read; a delayed apply revalidates before it commits.
export function createConsumer({ readSnapshotFor, options, delay = async () => {} }) {
  let chain = Promise.resolve();
  const state = { current: null, applied: [] };
  const apply = (envelope) => (chain = chain.then(async () => {
    const access = envelope.registry;
    if (access?.status !== 'ready') return 'not-ready';
    const { generation, revision } = access;
    if (state.current !== null && generation === state.current.generation && revision <= state.current.revision) return 'stale-revision';
    if (state.current === null || generation !== state.current.generation) {
      // Never order generation ids or trust an envelope to switch generations: ask the registry.
      if (await readSnapshotFor({ generation }, options) === null) return 'stale-generation';
    }
    await delay(envelope);
    const now = await readSnapshotFor({ generation }, options);
    if (now === null) return 'stale-generation';
    state.current = { generation, revision };
    state.applied.push({ generation, revision, value: envelope.value });
    return 'applied';
  }));
  return { apply, state };
}
