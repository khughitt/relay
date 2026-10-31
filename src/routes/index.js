// @ts-check
import { relayError } from '../protocol.js';
import * as claudeCode from './claude-code.js';
import * as codex from './codex.js';

/** @type {Record<string, {EXPIRY_MS:number}>} */
const ROUTES = Object.freeze({ 'claude-code': claudeCode, codex });

/** @param {import("../types.js").QuestionMessage} question */
function routeOf(question) {
  const route = ROUTES[/** @type {string} */ (question.body.native?.harness)];
  if (!route) throw relayError('UNSUPPORTED_ROUTE', 'no answer route for this question');
  return route;
}

/** @param {import("../types.js").QuestionEntry} entry */
export function expectAnswers(entry) {
  routeOf(entry.question);
  const answer=(/** @type {import('../types.js').AnswerMessage} */ (entry.answer)).body;
  if(entry.question.body.native?.harness==='codex') {
    if(!entry.route.connector)throw relayError('UNSUPPORTED_ROUTE','Codex needs connector ownership');
    return codex.nativeAnswers(entry.question,answer,entry.route.connector.items);
  }
  return claudeCode.nativeAnswers(entry.question,answer);
}

// The longest a question may wait on its route after createdAt (spec §5.4).
/** @param {import("../types.js").QuestionMessage} question */
export const expiryLimit = (question) => question.body.native === null ? 7 * 24 * 3600 * 1000 : routeOf(question).EXPIRY_MS;
