// Build isolated process/environment/registry inputs for the exported conformance cases.
import { relayError } from '../../src/protocol.js';

export function whoamiCase(inputs) {
  let registryCalls = 0;
  const processOps = {
    recordOf(pid) {
      const row = inputs.rows[pid];
      return row ? { pid, ...row } : null;
    },
    executableOf(pid) {
      if (!Object.hasOwn(inputs.exe, pid)) throw relayError('PROCESS_UNREADABLE', 'executable unreadable');
      return inputs.exe[pid];
    },
    argvOf(pid) {
      if (!Object.hasOwn(inputs.argv, pid)) throw relayError('PROCESS_UNREADABLE', 'arguments unreadable');
      return inputs.argv[pid];
    },
    handleOf(pid) {
      if (inputs.handleStart === null) return null;
      return { platform: inputs.platform, host: inputs.host, bootId: inputs.bootId,
        pid, start: inputs.handleStart ?? inputs.rows[pid].starttime };
    },
  };
  return {
    options: {
      startPid: inputs.startPid ?? 1000, platform: inputs.platform, processOps,
      env: inputs.env ?? {},
      readRaw() {
        if (inputs.environ === 'unreadable') throw relayError('EACCES', 'raw environment unreadable');
        return Buffer.concat(Object.entries(inputs.environ).map(([key, value]) => Buffer.concat([
          Buffer.from(`${key}=`), typeof value === 'string' ? Buffer.from(value)
            : Buffer.from(value.hex.replaceAll(' ', ''), 'hex'), Buffer.from([0]),
        ])));
      },
      async readRegistry() {
        registryCalls++;
        if (inputs.snapshot === 'corrupt') throw relayError('CORRUPT_STATE', 'fixture registry corrupt');
        return inputs.snapshot;
      },
    },
    registryCalls: () => registryCalls,
  };
}
