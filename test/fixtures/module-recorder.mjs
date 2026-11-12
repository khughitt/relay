// Registers a resolve hook that appends every resolved module URL to $RELAY_MODULE_LOG, so a test
// can assert which modules one CLI invocation loaded.
import { register } from 'node:module';
register(new URL('./module-recorder-hooks.mjs', import.meta.url), { data: { log: process.env.RELAY_MODULE_LOG } });
