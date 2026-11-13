// Preloaded with --require: notes every child_process.spawn (command and argv) in $RELAY_MODULE_LOG,
// in the same file the module recorder appends resolved modules to, so tests can order the two.
const cp = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const spawn = cp.spawn;
cp.spawn = function (command, args, options) {
  const child = spawn.call(this, command, args, options);
  if (process.env.RELAY_MODULE_LOG) appendFileSync(process.env.RELAY_MODULE_LOG, `SPAWN ${child.pid} ${[command, ...(args ?? [])].join(' ')}\n`);
  return child;
};
syncBuiltinESMExports();
