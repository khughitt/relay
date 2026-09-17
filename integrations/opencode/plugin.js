import { createBinding } from './binding.js';

export const Relay = async ({ directory } = {}) => {
  const binding = createBinding({ directory });
  return {
    event: async (input) => binding.onEvent(input),
    'permission.ask': async (permission) => binding.onPermissionAsk(permission),
    dispose: async () => binding.dispose(),
  };
};
