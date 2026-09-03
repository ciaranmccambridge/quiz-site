// Live leaderboard. Two halves:
//   1. Ranked scores -- the bit people want to see.
//   2. Per-question answer breakdown -- the bit that tells Ciaran which
//      questions to keep, which is the actual reason this site exists.

import { questions, maxScore, SESSION_ID } from './questions.js';
import { isConfigured, subscribeToSubmissions } from './firebase.js';

const els = {
  subtitle: document.getElementById('subtitle'),
  error: document.getElementById('error-banner'),
  table: document.getElementById('scores-table'),
  body: document.getElementById('scores-body'),
  empty: document.getElementById('scores-empty'),
  breakdown: document.getElementById('breakdown'),
};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.subtitle.textContent = '';
}

// -------------------------------------------------------------- scores table

export function rank(submissions) {
  return [...submissions].sort((a, b) => {
    // Score first; then whoever got further; then alphabetical so the order is
    // stable between snapshots rather than jumping around.
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    if ((b.answered || 0) !== (a.answered || 0)) return (b.answered || 0) - (a.answered || 0);
    return (a.username || '').localeCompare(b.username || '');
  });
}

export function renderScores(submissions) {
  const ranked = rank(submissions);

  els.table.hidden = ranked.length === 0;
  els.empty.hidden = ranked.length > 0;
  els.body.replaceChildren();

  ranked.forEach((entry, index) => {
    const row = document.createElement('tr');
    if (!entry.finished) row.className = 'in-progress';

    const position = document.createElement('td');
    position.className = 'rank';
    position.textContent = String(index + 1);

    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = entry.username || entry.id;

    const score = document.createElement('td');
    score.className = 'numeric';
    score.textContent = `${entry.score || 0} / ${entry.maxScore || maxScore}`;

    const done = document.createElement('td');
    done.className = 'numeric';
    done.textContent = `${entry.answered || 0} / ${entry.total || questions.length}`;

    row.append(position, name, score, done);
    els.body.append(row);
  });
}

// ---------------------------------------------------------- answer breakdown

/**
 * Reshape flat answer rows into: qid -> playerName -> fieldKey -> {raw, matched}
 * so each question block can list one line per player.
 */
export function groupAnswers(submissions) {
  const byQuestion = new Map();

  for (const submission of submissions) {
    const who = submission.username || submission.id;

    for (const answer of submission.answers || []) {
      if (!byQuestion.has(answer.qid)) byQuestion.set(answer.qid, new Map());
      const players = byQuestion.get(answer.qid);

      if (!players.has(who)) players.set(who, {});
      players.get(who)[answer.field] = { raw: answer.raw, matched: answer.matched };
    }
  }

  return byQuestion;
}

export function hitRateLabel(matched, attempted) {
  if (!attempted) return { text: 'no attempts yet', tone: '' };

  const percent = Math.round((matched / attempted) * 100);
  let tone = '';
  if (percent <= 30) tone = 'cold';
  else if (percent >= 80) tone = 'hot';

  return { text: `${matched}/${attempted} correct · ${percent}%`, tone };
}

export function renderQuestionBlock(question, players) {
  const block = document.createElement('div');
  block.className = 'question-block';

  let matched = 0;
  let attempted = 0;
  for (const fields of players.values()) {
    for (const field of Object.values(fields)) {
      attempted += 1;
      if (field.matched) matched += 1;
    }
  }

  const head = document.createElement('div');
  head.className = 'question-head';

  const id = document.createElement('span');
  id.className = 'question-id';
  id.textContent = question.id.toUpperCase();

  const rate = hitRateLabel(matched, attempted);
  const rateEl = document.createElement('span');
  rateEl.className = `hit-rate ${rate.tone}`;
  rateEl.textContent = rate.text;

  head.append(id, rateEl);

  const answer = document.createElement('p');
  answer.className = 'correct-answer';
  // accept[0] per field is the canonical answer.
  answer.textContent = question.fields.map((field) => field.accept[0] || '—').join('  ·  ');

  block.append(head, answer);

  if (players.size === 0) {
    const none = document.createElement('p');
    none.className = 'empty';
    none.textContent = 'Nobody has reached this one yet.';
    block.append(none);
    return block;
  }

  const list = document.createElement('ul');
  list.className = 'answer-list';

  for (const [who, fields] of [...players.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const item = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'answer-who';
    name.textContent = who;
    item.append(name);

    const text = document.createElement('span');
    text.className = 'answer-text';

    // Show the fields in the question's own order, not whatever order they
    // happen to arrive in from Firestore.
    const parts = question.fields.map((field) => {
      const entry = fields[field.key];
      if (!entry) return '—';
      const mark = entry.matched ? '✅' : '❌';
      return `${mark} ${entry.raw || '(blank)'}`;
    });

    text.textContent = parts.join('   ·   ');
    if (!parts.some((part) => part !== '—')) text.className = 'answer-text blank';

    item.append(text);
    list.append(item);
  }

  block.append(list);
  return block;
}

export function renderBreakdown(submissions) {
  const grouped = groupAnswers(submissions);

  // Iterate `questions`, not the grouped keys, so unanswered questions still
  // appear rather than silently vanishing.
  const blocks = questions.map((question) =>
    renderQuestionBlock(question, grouped.get(question.id) || new Map())
  );

  els.breakdown.replaceChildren(...blocks);
}

// ------------------------------------------------------------------ bootstrap

export function render(submissions) {
  const players = submissions.length;
  const finished = submissions.filter((entry) => entry.finished).length;

  els.subtitle.textContent =
    players === 0
      ? 'Waiting for the first player…'
      : `${players} player${players === 1 ? '' : 's'}, ${finished} finished. Updates live.`;

  renderScores(submissions);
  renderBreakdown(submissions);
}

// Render the question list up front, whatever happens next. It means the page
// shows the round while the subscription is still connecting, and still shows
// something useful if the subscription fails outright rather than going blank.
renderBreakdown([]);

if (!isConfigured) {
  showError(
    'Firebase isn’t configured, so there are no shared results to show. Paste your config into assets/firebase.js.'
  );
} else {
  subscribeToSubmissions(SESSION_ID, render, (error) =>
    showError(`Could not load results: ${error.message}. Check your Firestore rules.`)
  );
}
