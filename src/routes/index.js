// @ts-check
import { relayError } from '../protocol.js';
import * as claudeCode from './claude-code.js';

/** @type {Record<string, typeof claudeCode>} */
const ROUTES = Object.freeze({ 'claude-code': claudeCode });

/** @param {import("../types.js").QuestionMessage} question */
function routeOf(question) {
  const route = ROUTES[/** @type {string} */ (question.body.native?.harness)];
  if (!route) throw relayError('UNSUPPORTED_ROUTE', 'no answer route for this question');
  return route;
}

/** @param {import("../types.js").QuestionEntry} entry */
export function expectAnswers(entry) {
  return routeOf(entry.question).nativeAnswers(entry.question, (/** @type {import("../types.js").AnswerMessage} */ (entry.answer)).body);
}

// The longest a question may wait on its route after createdAt (spec §5.4).
/** @param {import("../types.js").QuestionMessage} question */
export const expiryLimit = (question) => routeOf(question).EXPIRY_MS;
