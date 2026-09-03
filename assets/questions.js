// Turns the authored content in quiz-data.js into the shape the app consumes,
// and sanity-checks it. Kept separate so quiz-data.js stays pure content with
// no logic to trip over while editing.

import {
  QUESTIONS,
  QUESTIONS_SHOWN,
  SESSION_ID,
  ROUND_TITLE,
  ROUND_BLURB,
} from './quiz-data.js';

export { SESSION_ID, ROUND_TITLE, ROUND_BLURB };

// How many questions to use. Asking for more than exist is a config mistake
// worth surfacing, but it shouldn't break the round -- so clamp and warn.
function resolveCount(available) {
  const requested = Number(QUESTIONS_SHOWN);

  if (!Number.isFinite(requested) || requested < 1) {
    console.error(
      `QUESTIONS_SHOWN is ${JSON.stringify(QUESTIONS_SHOWN)}, which isn't a usable count. ` +
        `Using all ${available} questions.`
    );
    return available;
  }

  const count = Math.floor(requested);

  if (count > available) {
    console.warn(
      `QUESTIONS_SHOWN is ${count} but quiz-data.js only defines ${available} questions. ` +
        `Using all ${available}.`
    );
    return available;
  }

  return count;
}

// These files get hand-edited under time pressure, so fail loudly and early
// rather than silently scoring a question nobody can win.
function validate(list) {
  const seenIds = new Set();

  list.forEach((question, index) => {
    const where = question.id || `question at index ${index}`;

    if (!question.id) console.error(`${where}: missing "id"`);
    if (seenIds.has(question.id)) {
      console.error(`${where}: duplicate id -- results will overwrite each other`);
    }
    seenIds.add(question.id);

    if (!question.audio) console.error(`${where}: missing "audio" path`);
    if (!question.fields || !question.fields.length) {
      console.error(`${where}: has no fields, so it cannot be answered`);
      return;
    }

    question.fields.forEach((field) => {
      if (!field.key) console.error(`${where}: a field is missing "key"`);
      if (!field.accept.length) {
        console.error(`${where}.${field.key}: empty "accept" -- nobody can score this`);
      }
    });
  });
}

const decoded = QUESTIONS.map((question) => ({
  ...question,
  fields: (question.fields || []).map((field) => ({
    key: field.key,
    label: field.label || field.key,
    accept: field.accept || [],
  })),
}));

/** The questions actually in play, taken from the top of the authored list. */
export const questions = decoded.slice(0, resolveCount(decoded.length));

/** Total questions defined, whether or not they're in this round. */
export const availableCount = decoded.length;

validate(questions);

/** One point per field. */
export const maxScore = questions.reduce((total, q) => total + q.fields.length, 0);

export function questionById(id) {
  return questions.find((question) => question.id === id);
}
