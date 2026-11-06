import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite') {
      throw Object.assign(new Error('SQLite unavailable in this fixture runtime'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' });
    }
    return nextResolve(specifier, context);
  },
});
