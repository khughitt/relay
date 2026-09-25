import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [clone, mode, arg] = process.argv.slice(2);
const { createProcessOps } = await import(pathToFileURL(join(clone, 'src/index.js')).href);
const ops = createProcessOps();
process.stdout.write(JSON.stringify(mode === 'handle' ? ops.handleOf(Number(arg)) : ops.probe(JSON.parse(arg))));
