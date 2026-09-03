// Run: node tests/leaderboard.test.mjs
//
// Exercises the leaderboard against fabricated Firestore submissions, so the
// ranking and the per-question breakdown can be verified without a browser or a
// live Firebase project.
//
// The breakdown is the reason this whole site exists -- it's what tells you
// which questions to bin -- so it gets the most attention here.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDocument, LocalStorage, createChecker } from './dom-shim.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { check, report } = createChecker();

const doc = buildDocument(join(ROOT, 'leaderboard', 'index.html'));
globalThis.document = doc;
globalThis.localStorage = new LocalStorage();

// Importing runs the bootstrap. With no Firebase config it takes the
// error-banner path, which is itself worth asserting.
const board = await import('../assets/leaderboard.js');
const { questions, maxScore } = await import('../assets/questions.js');
const { isConfigured } = await import('../assets/firebase.js');

const el = (id) => doc.getElementById(id);

// Safe accessor: a missing block should surface as a readable assertion failure
// rather than a TypeError that aborts the run before anything is reported.
const blockText = (index) => el('breakdown').children[index]?.text() ?? '(no such block)';

// ---- Bootstrap
//
// Under node the SDK can't load either way -- unconfigured takes the "paste your
// config" path, configured takes the subscription-failed path. Both must surface
// an explanation, so assert that rather than one specific message; otherwise
// this breaks the moment a real config is pasted in, which it did once already.

check('an error banner is shown when results cannot load', el('error-banner').hidden, false);
check('the banner actually explains something', el('error-banner').textContent.length > 20, true);

if (!isConfigured) {
  check(
    'unconfigured banner names the file to edit',
    el('error-banner').textContent.includes('assets/firebase.js'),
    true
  );
}

// The question list renders regardless, so the page is never blank.
check('breakdown rendered before any results arrive', el('breakdown').children.length, questions.length);
check(
  'unreached question is labelled, not omitted',
  blockText(0).includes('Nobody has reached this one yet'),
  true
);

// ---- Ranking

const submissions = [
  // Deliberately out of order, and Alice is mid-round on a tie-break.
  { id: 'bob', username: 'Bob', score: 5, maxScore, answered: 10, total: 10, finished: true, answers: [] },
  { id: 'alice', username: 'Alice', score: 8, maxScore, answered: 7, total: 10, finished: false, answers: [] },
  { id: 'cara', username: 'Cara', score: 8, maxScore, answered: 10, total: 10, finished: true, answers: [] },
  { id: 'dan', username: 'Dan', score: 5, maxScore, answered: 4, total: 10, finished: false, answers: [] },
];

const order = board.rank(submissions).map((entry) => entry.username);
check('highest score first', order[0], 'Cara');
check('tie broken by progress, not name', order[1], 'Alice');
check('lower scores follow', order[2], 'Bob');
check('least progress last', order[3], 'Dan');

// Stable ordering matters: rows shouldn't jump around between live snapshots.
const repeat = board.rank(submissions).map((entry) => entry.username);
check('ranking is deterministic', repeat.join(), order.join());

board.render(submissions);

check('all players rendered', el('scores-body').children.length, 4);
check('scores table visible', el('scores-table').hidden, false);
check('empty notice hidden', el('scores-empty').hidden, true);
check(
  'unfinished players flagged',
  el('scores-body').children.filter((row) => row.className === 'in-progress').length,
  2
);
check(
  'subtitle counts players and finishers',
  el('subtitle').textContent,
  '4 players, 2 finished. Updates live.'
);

// ---- Empty state

board.render([]);
check('table hidden when nobody has played', el('scores-table').hidden, true);
check('empty notice shown', el('scores-empty').hidden, false);
check('waiting subtitle', el('subtitle').textContent, 'Waiting for the first player…');

// ---- Hit rate labelling

check('no attempts', board.hitRateLabel(0, 0).text, 'no attempts yet');
check('cold tone when hardly anyone got it', board.hitRateLabel(1, 10).tone, 'cold');
check('cold at exactly 30%', board.hitRateLabel(3, 10).tone, 'cold');
check('neutral in the middle', board.hitRateLabel(5, 10).tone, '');
check('hot when nearly everyone got it', board.hitRateLabel(9, 10).tone, 'hot');
check('hit rate text', board.hitRateLabel(3, 8).text, '3/8 correct · 38%');

// ---- Grouping flat answer rows
//
// Artist-only questions now, so one answer row per player per question.

const withAnswers = [
  {
    id: 'ciaran',
    username: 'Ciaran',
    score: 1,
    maxScore,
    answered: 2,
    total: 10,
    finished: false,
    answers: [
      { qid: 'q01', field: 'artist', raw: 'Queen', matched: true },
      { qid: 'q02', field: 'artist', raw: '', matched: false }, // left blank
    ],
  },
  {
    id: 'nadia',
    username: 'Nadia',
    score: 0,
    maxScore,
    answered: 1,
    total: 10,
    finished: false,
    answers: [{ qid: 'q01', field: 'artist', raw: 'The Beatles', matched: false }],
  },
];

const grouped = board.groupAnswers(withAnswers);
check('grouped by question', grouped.size, 2);
check('q01 has both players', grouped.get('q01').size, 2);
check('q02 has only the one who reached it', grouped.get('q02').size, 1);
check('raw text preserved verbatim', grouped.get('q01').get('Nadia').artist.raw, 'The Beatles');

// ---- Breakdown rendering: the payoff

board.render(withAnswers);

check('one block per question', el('breakdown').children.length, questions.length);

const q01 = blockText(0);
check('q01 shows the question id', q01.includes('Q01'), true);
check('q01 shows the correct answer', q01.includes(questions[0].fields[0].accept[0]), true);
check('q01 lists both players', q01.includes('Ciaran') && q01.includes('Nadia'), true);
check('q01 shows a wrong answer as typed', q01.includes('The Beatles'), true);
check('q01 hit rate computed', q01.includes('1/2 correct · 50%'), true);
check('q01 mid hit rate is untoned', el('breakdown').children[0]?.byClass('hit-rate ').length ?? 0, 1);

const q02 = blockText(1);
check('q02 marks a blank field', q02.includes('(blank)'), true);
check('q02 hit rate is zero', q02.includes('0/1 correct · 0%'), true);
check(
  'q02 hit rate flagged cold',
  el('breakdown').children[1]?.byClass('hit-rate cold').length ?? 0,
  1
);

// A question nobody reached must still appear, or you'd think it was fine.
check(
  'untouched question still listed',
  blockText(2).includes('Nobody has reached this one yet'),
  true
);

report('leaderboard assertions');
