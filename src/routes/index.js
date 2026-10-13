import { relayError } from '../protocol.js';
import * as claudeCode from './claude-code.js';

const ROUTES = Object.freeze({ 'claude-code': claudeCode });

export function expectAnswers(entry) {
  const route = ROUTES[entry.question.body.native?.harness];
  if (!route) throw relayError('UNSUPPORTED_ROUTE', 'no answer route for this question');
  return route.nativeAnswers(entry.question, entry.answer.body);
}
