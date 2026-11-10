// The tasks consumer's claim rules, using only relay's response and the held claim.
const sameSession = (claim, harness, id) => claim === id || claim === `${harness}:${id}`
  || (harness === 'claude-code' && claim === `claude:${id}`);

export function tasksProofOnly(result, claim) {
  if (result.schema !== 1 || !['resolved', 'unresolved'].includes(result.status)) return false;
  const boundary = result.boundary;
  if (!boundary || boundary.role !== 'session' || result.code === 'HIDDEN_ANCESTRY') return false;
  const process = boundary.process;
  if (process.platform !== 'linux' || !process.bootId || process.host !== claim.host
      || process.bootId !== claim.bootId || process.pid !== claim.pid || process.start !== claim.pidStart) return false;
  const { harness } = boundary;
  if (harness === 'codex') {
    const thread = result.native.CODEX_THREAD_ID;
    const root = result.native.CODEX_SESSION_ID;
    return !['invalid', 'unverified'].includes(root.state) && thread.state === 'present'
      && sameSession(claim.session, harness, thread.value);
  }
  if (harness === 'agy') {
    const conversation = result.native.ANTIGRAVITY_CONVERSATION_ID;
    return conversation.state === 'present' && sameSession(claim.session, harness, conversation.value);
  }
  return result.hint === null || sameSession(claim.session, harness, result.hint);
}

export function tasksClaimSession(result) {
  return result.schema === 1 && result.status === 'resolved' && result.agent.process?.platform === 'linux'
    && result.agent.process.bootId ? result.agent.id : null;
}
