import { relayError } from '../protocol.js';
import * as claudeCode from './claude-code.js';

const ROUTES = Object.freeze({ 'claude-code': claudeCode });

function routeOf(question) {
  const route = ROUTES[question.body.native?.harness];
  if (!route) throw relayError('UNSUPPORTED_ROUTE', 'no answer route for this question');
  return route;
}

export function expectAnswers(entry) {
  return routeOf(entry.question).nativeAnswers(entry.question, entry.answer.body);
}

// The longest a question may wait on its route after createdAt (spec §5.4).
export const expiryLimit = (question) => routeOf(question).EXPIRY_MS;
