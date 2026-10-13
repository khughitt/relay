// relay ask without the CLI wiring (Task 12 adds it): argv EVENT [--handback]; stdin is the
// native payload; RELAY_STATE_DIR names the service.
import { runAsk } from '../../src/routes/ask.js';
import { servePaths } from '../../src/serve/serve.js';
import { paths } from '../../src/bus/paths.js';
const [nativeEvent, flag] = process.argv.slice(2);
const r = await runAsk({ nativeEvent, handback: flag === '--handback', stdin: process.stdin, socketPath: servePaths(paths().stateDir).socketPath });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
process.exitCode = r.exitCode;
