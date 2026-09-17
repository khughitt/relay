export function pruneDead(agents, { probe }) {
  const kept = {}, reaped = [], liveness = {};
  for (const [id,agent] of Object.entries(agents)) {
    const result = probe(agent.process); liveness[id] = result;
    if (result.status === 'dead') reaped.push(id); else kept[id] = agent;
  }
  return { agents:kept, reaped, liveness };
}
