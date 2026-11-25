// Forwards a harness extension's events to `relay hook`: one ordered queue of short-lived hook
// processes, and an error log of its own. Shared by the in-process integrations (opencode, pi).
export { createQueue } from './queue.js';
export { spawnHook } from './hook.js';
export { logError } from './log.js';
