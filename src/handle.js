// Public process-handle input validation.
// @ts-check
import { relayError, validateHandle as validateSchemaHandle } from './protocol.js';

/** @param {unknown} value @returns {Readonly<import('./types.js').Handle>} */
export function validateHandle(value) {
  try { return Object.freeze(validateSchemaHandle(value)); }
  catch (caught) {
    const error = /** @type {import('./types.js').Failure} */ (caught);
    if (error.code !== 'INVALID_SCHEMA') throw error;
    throw relayError('INVALID_INPUT', error.message, error);
  }
}
