// Run: node tests/flow.test.mjs
//
// Drives assets/app.js end to end with no browser: login, answering questions in
// any order on the single scrolling page, reveals, scoring, resume-after-refresh
// and restart.
//
// The DOM shim (tests/dom-shim.mjs) is deliberately minimal and dumb -- it
// implements only the handful of APIs app.js touches. That's the point: a
// sophisticated fake would end up testing itself. Anything that passes here is
// real app logic, though a browser is still needed to confirm it *looks* right
// and that audio actually plays.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDocument, LocalStorage, createChecker } from './dom-shim.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { check, report } = createChecker();
const storage = new LocalStorage();

// ------------------------------------------------------------ harness

let doc;

async function loadApp(version) {
  doc = buildDocument(join(ROOT, 'index.html'));
  globalThis.document = doc;
  globalThis.localStorage = storage;

  // Cache-bust so each "page load" re-runs app.js bootstrap against a fresh DOM.
  await import(`../assets/app.js?v=${version}`);
  return doc;
}

const el = (id) => doc.getElementById(id);
const cardAt = (i) => el('question-list').children[i];
const formAt = (i) => cardAt(i)?.querySelector('form') ?? null;
const audioAt = (i) => cardAt(i)?.querySelector('audio') ?? null;
const cardText = (i) => cardAt(i)?.text() ?? '(no such card)';

/** Fill and submit the form in card `i`. Omit a field to leave it blank. */
function answerAt(i, values) {
  const form = formAt(i);
  if (!form) throw new Error(`card ${i} has no answer form`);

  for (const [name, value] of Object.entries(values)) {
    if (!form.elements[name]) throw new Error(`card ${i} has no input named ${name}`);
    form.elements[name].value = value;
  }

  form.fire('submit');
}

// --------------------------------------------------------------- tests

const { questions, maxScore, availableCount } = await import('../assets/questions.js');
const { isMatch, normalize, levenshtein } = await import('../assets/match.js');
const { QUESTIONS, QUESTIONS_SHOWN } = await import('../assets/quiz-data.js');
// Only read at module top level -- importing this does not touch the network.
const { isConfigured } = await import('../assets/firebase.js');

// ---- 0a. QUESTIONS_SHOWN controls the round length

check('all defined questions counted', availableCount, QUESTIONS.length);

// The documented contract: a usable count is clamped to what's defined; an
// unusable one (0, negative, not a number) falls back to using them all. Spelled
// out rather than hard-coded, so this still holds whatever you set the knob to.
const expectedCount =
  Number.isFinite(Number(QUESTIONS_SHOWN)) && Number(QUESTIONS_SHOWN) >= 1
    ? Math.min(Math.floor(Number(QUESTIONS_SHOWN)), QUESTIONS.length)
    : QUESTIONS.length;

check('round length honours QUESTIONS_SHOWN', questions.length, expectedCount);
check('questions taken from the top of the list', questions[0].id, QUESTIONS[0].id);
check('one point per question (artist only)', maxScore, questions.length);
check('every question has exactly one field', questions.every((q) => q.fields.length === 1), true);
check('the field is the artist', questions.every((q) => q.fields[0].key === 'artist'), true);

// ---- 0b. Question data sanity
//
// Note on what is NOT worth asserting: "every accepted answer matches its own
// field" is tautological. Exact-match normalisation always succeeds for a string
// against a list containing that string, so the assertion passes no matter how
// mangled the entry is. The checks below were chosen because they can fail.

for (const question of questions) {
  for (const field of question.fields) {
    check(`${question.id}.${field.key} has answers`, field.accept.length > 0, true);

    // An entry of punctuation normalises to nothing, which silently makes the
    // field unwinnable -- isMatch rejects empty guesses.
    for (const alias of field.accept) {
      check(
        `${question.id}.${field.key} entry "${alias}" survives normalisation`,
        normalize(alias).length > 0,
        true
      );
    }
  }
}

// Cross-question collisions: a real signal that the matcher is too loose against
// this specific data. Two questions legitimately sharing an artist is fine, so
// only flag genuinely *different* answers that match each other.
for (const a of questions) {
  for (const fieldA of a.fields) {
    for (const b of questions) {
      if (a.id === b.id) continue;

      for (const fieldB of b.fields) {
        if (fieldA.key !== fieldB.key) continue;
        if (normalize(fieldA.accept[0]) === normalize(fieldB.accept[0])) continue;

        check(
          `${a.id} ("${fieldA.accept[0]}") does not also match ${b.id}`,
          isMatch(fieldA.accept[0], fieldB.accept),
          false
        );
      }
    }
  }
}

const ids = questions.map((question) => question.id);
check('question ids unique', new Set(ids).size, ids.length);

const clips = questions.map((question) => question.audio);
check('audio paths unique', new Set(clips).size, clips.length);

// ---- 1. Login gate

await loadApp(1);
check('starts on login', el('login-view').hidden, false);
check('quiz hidden before login', el('quiz-view').hidden, true);
check('local-mode banner shown (no firebase config)', el('local-only-banner').hidden, false);

el('username-input').value = 'Ciaran';
el('login-form').fire('submit');

check('quiz shown after login', el('quiz-view').hidden, false);
check('login hidden after login', el('login-view').hidden, true);

// ---- 2. Every question is on the page at once

check('one card per question', el('question-list').children.length, questions.length);
check('done panel hidden at the start', el('done-panel').hidden, true);
check(
  'progress counts answers, not position',
  el('progress-label').textContent,
  `0 of ${questions.length} answered`
);
check('score starts at zero', el('score-label').textContent, `0 / ${maxScore} pts`);

for (let i = 0; i < questions.length; i++) {
  check(`card ${i + 1} numbered`, cardText(i).includes(String(i + 1)), true);
  check(`card ${i + 1} has its own audio`, audioAt(i).src, questions[i].audio);
  check(`card ${i + 1} starts with a form`, formAt(i) !== null, true);
}

// Preloading every clip on one page would pull several MB the moment it opens.
check('audio not eagerly preloaded', audioAt(0).preload, 'metadata');

// ---- 3. Answering out of order, and audio elsewhere must survive it
//
// Indices are derived from the round length rather than hard-coded, so lowering
// QUESTIONS_SHOWN skips the scenarios that no longer fit instead of crashing the
// suite -- which matters, because changing that knob is the whole point of it.

const wrongIdx = 0;
const blankIdx = questions.length > 1 ? 1 : null;
const orderIdx = questions.length > 2 ? 2 : null;
const spectatorIdx = questions.length > 3 ? questions.length - 1 : null;

/**
 * Swap two adjacent LETTERS near the middle -- a transposition, which costs 2
 * edits and so needs a 10+ character answer to fall inside the typo budget.
 *
 * Letters specifically, not any two characters: transposing around punctuation
 * produces something normalisation collapses back to the original, and the test
 * then passes at edit distance 0 while looking like it tested fuzzy matching.
 * Returns null when no valid position exists.
 */
function transpose(text) {
  for (let i = Math.floor(text.length / 2); i < text.length - 1; i++) {
    const [a, b] = [text[i], text[i + 1]];
    if (/[a-z]/.test(a) && /[a-z]/.test(b) && a !== b) {
      return text.slice(0, i) + b + a + text.slice(i + 2);
    }
  }
  return null;
}

// Pick a typo target from the data instead of naming a specific artist, so this
// keeps working whatever questions are in play.
const fuzzyIdx = questions.findIndex(
  (question, i) =>
    ![wrongIdx, blankIdx, orderIdx].includes(i) &&
    normalize(question.fields[0].accept[0]).length >= 10 &&
    transpose(normalize(question.fields[0].accept[0])) !== null
);

if (orderIdx !== null) {
  const audioBefore = spectatorIdx !== null ? audioAt(spectatorIdx) : null;
  const cardBefore = spectatorIdx !== null ? cardAt(spectatorIdx) : null;

  answerAt(orderIdx, { artist: questions[orderIdx].fields[0].accept[0] }); // not first

  check('answered card shows a reveal', formAt(orderIdx), null);
  check('answered card marked correct', cardText(orderIdx).includes('✅'), true);
  check('other cards untouched', formAt(wrongIdx) !== null, true);
  check('answered card flagged for styling', cardAt(orderIdx).className.includes('answered'), true);
  check('score reflects the one answer', el('score-label').textContent, `1 / ${maxScore} pts`);
  check(
    'progress reflects the one answer',
    el('progress-label').textContent,
    `1 of ${questions.length} answered`
  );
  check('done panel still hidden', el('done-panel').hidden, true);

  // The assertion that matters now everything shares a page: re-rendering the
  // whole list on submit would destroy the other <audio> elements and cut off
  // anything playing. Preserved identity proves it doesn't.
  if (spectatorIdx !== null) {
    check('unrelated audio element not rebuilt', audioAt(spectatorIdx), audioBefore);
    check('unrelated card element not rebuilt', cardAt(spectatorIdx), cardBefore);
  }
} else {
  console.log('  (skipped out-of-order checks: needs 3+ questions)');
}


// ---- 4. Wrong, blank and fuzzy answers

let expectedScore = orderIdx !== null ? 1 : 0;
let misses = 0;

answerAt(wrongIdx, { artist: 'Definitely Not It' });
misses += 1;
check('wrong answer marked', cardText(wrongIdx).includes('❌'), true);
check('echoes the typed text back', cardText(wrongIdx).includes('You said: Definitely Not It'), true);
check(
  'shows the correct answer',
  cardText(wrongIdx).includes(questions[wrongIdx].fields[0].accept[0]),
  true
);
check('wrong answer scores nothing', el('score-label').textContent, `${expectedScore} / ${maxScore} pts`);

if (blankIdx !== null) {
  answerAt(blankIdx, {}); // submit with nothing typed
  misses += 1;
  check('blank answer flagged', cardText(blankIdx).includes('You left this blank'), true);
  check(
    'blank still counts as answered',
    el('progress-label').textContent,
    `${orderIdx !== null ? 3 : 2} of ${questions.length} answered`
  );
} else {
  console.log('  (skipped blank-answer check: needs 2+ questions)');
}

// Fuzzy matching must reach the real flow, not just the matcher unit test.
if (fuzzyIdx !== -1) {
  const field = questions[fuzzyIdx].fields[0];
  const canonical = normalize(field.accept[0]);
  const typo = transpose(canonical);

  // Guard: if normalisation collapses the typo back to the canonical form, this
  // would be testing exact matching and quietly claiming to test typos.
  check(`typo "${typo}" is not just an exact match`, normalize(typo) === canonical, false);
  check(`typo "${typo}" is genuinely close`, levenshtein(normalize(typo), canonical) > 0, true);

  answerAt(fuzzyIdx, { artist: typo });
  expectedScore += 1;
  check(
    `typo "${typo}" still scores in-app`,
    el('score-label').textContent,
    `${expectedScore} / ${maxScore} pts`
  );
} else {
  console.log('  (skipped in-app fuzzy check: no answer suitable for a typo)');
}

// ---- 5. Finishing reveals the summary

for (let i = 0; i < questions.length; i++) {
  if (formAt(i)) answerAt(i, { artist: questions[i].fields[0].accept[0] });
}

check(
  'all questions answered',
  el('progress-label').textContent,
  `${questions.length} of ${questions.length} answered`
);
check('done panel appears', el('done-panel').hidden, false);
// The deliberately-missed cards can't be retried once revealed.
check(
  'final score excludes the missed ones',
  el('final-score').textContent,
  `${maxScore - misses} / ${maxScore}`
);
// The completion note depends on whether a Firebase config has been pasted in,
// so assert against that rather than hard-coding one of the two messages --
// otherwise this fails the moment the project goes live, which it did.
check(
  `done note matches firebase state (configured: ${isConfigured})`,
  el('done-note').textContent.includes(
    isConfigured ? 'Your answers are saved' : 'stayed in your browser'
  ),
  true
);

// ---- 6. Resume after a refresh

await loadApp(2);
check('resume skips login', el('login-view').hidden, true);
check('resume rebuilds every card', el('question-list').children.length, questions.length);
check('resume restores the score', el('score-label').textContent, `${maxScore - misses} / ${maxScore} pts`);
check('resume restores the done panel', el('done-panel').hidden, false);
check('resume restores a reveal, not a form', formAt(0), null);
check('resume keeps the typed text', cardText(0).includes('Definitely Not It'), true);

// ---- 7. Restart keeps the name but clears answers

el('restart-button').fire('click');
check('restart does not ask for the name again', el('login-view').hidden, true);
check('restart zeroes the score', el('score-label').textContent, `0 / ${maxScore} pts`);
check(
  'restart resets progress',
  el('progress-label').textContent,
  `0 of ${questions.length} answered`
);
check('restart hides the done panel', el('done-panel').hidden, true);
check('restart restores the forms', formAt(0) !== null, true);
check('restart clears the reveals', cardText(0).includes('You said'), false);

// ---- 8. Audio behaviour
//
// Runs last, on the fresh post-restart page, so every card still has a form and
// there's no state to unwind afterwards.

const first = audioAt(wrongIdx);
first.play();
check('a clip plays when started', first.paused, false);

// Only one clip at a time. Browsers will happily overlap any number of <audio>
// elements, and with every question on one page that's the default outcome --
// so this is enforced in app code and has to be tested.
if (blankIdx !== null) {
  const second = audioAt(blankIdx);
  second.play();

  check('starting a second clip stops the first', first.paused, true);
  check('the second clip is playing', second.paused, false);

  if (orderIdx !== null) {
    const third = audioAt(orderIdx);
    third.play();

    check('starting a third stops the second', second.paused, true);
    check('the third clip is playing', third.paused, false);
    check('the already-stopped first stays stopped', first.paused, true);

    third.pause();
  } else {
    second.pause();
  }
} else {
  console.log('  (skipped exclusive-playback checks: needs 2+ questions)');
}

// Submitting deliberately leaves playback alone -- clips run to the end, and
// people stop them with the native control.
first.play();
const pausesBeforeSubmit = first.pauseCalls;

answerAt(wrongIdx, { artist: questions[wrongIdx].fields[0].accept[0] });

check('submitting does not stop the clip', first.paused, false);
check('submitting does not pause it', first.pauseCalls, pausesBeforeSubmit);

// Restart is different, and this one is a real bug rather than a preference:
// detaching a playing <audio> does not reliably stop it, so a clip could carry
// on sounding over a freshly rebuilt page with no visible control to stop it.
first.play();
el('restart-button').fire('click');
check('rebuilding the list stops clips left playing', first.paused, true);

report('flow assertions');
