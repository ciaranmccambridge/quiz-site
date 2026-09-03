// Quiz flow: login, then every question on one scrollable page.
//
// Questions can be answered in any order. Submitting one reveals that question's
// answer in place and leaves the rest alone -- deliberately, so audio playing in
// another card keeps playing. Only the submitted card's answer area is
// re-rendered; the <audio> elements are never rebuilt.
//
// Progress lives in localStorage so a refresh resumes rather than restarting,
// and is mirrored to Firestore after every answer so partial rounds still
// produce data.

import { isMatch } from './match.js';
import { questions, maxScore, SESSION_ID, ROUND_TITLE, ROUND_BLURB } from './questions.js';
import { isConfigured, saveProgress } from './firebase.js';

const STORAGE_KEY = `quiz:${SESSION_ID}`;

const views = {
  login: document.getElementById('login-view'),
  quiz: document.getElementById('quiz-view'),
};

const els = {
  banner: document.getElementById('local-only-banner'),
  title: document.getElementById('round-title'),
  blurb: document.getElementById('round-blurb'),
  quizTitle: document.getElementById('quiz-title'),
  quizBlurb: document.getElementById('quiz-blurb'),
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username-input'),
  progressLabel: document.getElementById('progress-label'),
  scoreLabel: document.getElementById('score-label'),
  progressFill: document.getElementById('progress-fill'),
  list: document.getElementById('question-list'),
  donePanel: document.getElementById('done-panel'),
  finalScore: document.getElementById('final-score'),
  doneNote: document.getElementById('done-note'),
  restart: document.getElementById('restart-button'),
};

const state = {
  username: '',
  // qid -> { [fieldKey]: { raw, matched } }
  results: {},
};

// qid -> { card, audio, slot }. Built once; `slot` is the only part ever
// replaced. `audio` is held so submitting can stop that question's clip.
const cards = new Map();

// ---------------------------------------------------------------- storage

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || !saved.username) return;

    state.username = saved.username;
    state.results = saved.results || {};
  } catch (error) {
    console.warn('Could not read saved progress; starting fresh.', error);
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ username: state.username, results: state.results })
    );
  } catch (error) {
    // Private browsing can refuse writes. The round still plays; only resume breaks.
    console.warn('Could not save progress locally.', error);
  }
}

// ------------------------------------------------------------------ score

function isAnswered(questionId) {
  return Boolean(state.results[questionId]);
}

function totalScore() {
  return questions.reduce((sum, question) => {
    const result = state.results[question.id];
    if (!result) return sum;
    return sum + Object.values(result).filter((field) => field.matched).length;
  }, 0);
}

function answeredCount() {
  return questions.filter((question) => isAnswered(question.id)).length;
}

/** Firestore doc id: stable, path-safe, and the de-dupe key for the leaderboard. */
function playerId(username) {
  const slug = username
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // A name of pure punctuation would otherwise yield an invalid empty id.
  return slug || 'player';
}

// Flattened for the leaderboard's per-question breakdown: one row per field,
// carrying the raw typed text, which is the whole reason for this exercise.
function flattenAnswers() {
  const rows = [];

  for (const question of questions) {
    const result = state.results[question.id];
    if (!result) continue;

    for (const field of question.fields) {
      const entry = result[field.key];
      if (!entry) continue;

      rows.push({ qid: question.id, field: field.key, raw: entry.raw, matched: entry.matched });
    }
  }

  return rows;
}

function sync() {
  // Fire-and-forget: a failed sync must never block the player.
  saveProgress(SESSION_ID, playerId(state.username), {
    username: state.username,
    score: totalScore(),
    maxScore,
    answered: answeredCount(),
    total: questions.length,
    finished: answeredCount() === questions.length,
    answers: flattenAnswers(),
  });
}

// ------------------------------------------------------------- rendering

function show(name) {
  for (const [key, view] of Object.entries(views)) {
    view.hidden = key !== name;
  }
}

function buildAnswerForm(question) {
  const form = document.createElement('form');
  form.autocomplete = 'off';
  form.className = 'answer-form';

  for (const field of question.fields) {
    const label = document.createElement('label');
    label.className = 'field';

    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = field.label;

    const input = document.createElement('input');
    input.type = 'text';
    input.name = field.key;
    input.maxLength = 120;
    input.placeholder = `${field.label}…`;

    label.append(caption, input);
    form.append(label);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary';
  submit.textContent = 'Submit';
  form.append(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAnswer(question, form);
  });

  return form;
}

function buildReveal(question) {
  const wrap = document.createElement('div');
  wrap.className = 'reveal';

  const result = state.results[question.id] || {};

  for (const field of question.fields) {
    const entry = result[field.key] || { raw: '', matched: false };

    const row = document.createElement('div');
    row.className = 'reveal-row';

    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = entry.matched ? '✅' : '❌';

    const body = document.createElement('div');
    body.className = 'reveal-body';

    const label = document.createElement('div');
    label.className = 'reveal-label';
    label.textContent = field.label;

    const answer = document.createElement('div');
    answer.className = `reveal-answer ${entry.matched ? 'correct' : 'wrong'}`;
    // accept[0] is the canonical answer; the rest are aliases.
    answer.textContent = field.accept[0] || '(no answer set)';

    body.append(label, answer);

    // Only worth echoing back if they got it wrong.
    if (!entry.matched) {
      const typed = document.createElement('div');
      typed.className = 'reveal-typed';
      typed.textContent = entry.raw ? `You said: ${entry.raw}` : 'You left this blank';
      body.append(typed);
    }

    row.append(mark, body);
    wrap.append(row);
  }

  return wrap;
}

/** Replace just this question's answer area, leaving its <audio> untouched. */
function renderAnswerSlot(question) {
  const entry = cards.get(question.id);
  if (!entry) return;

  const answered = isAnswered(question.id);
  entry.slot.replaceChildren(
    answered ? buildReveal(question) : buildAnswerForm(question)
  );
  entry.card.className = `card question-card${answered ? ' answered' : ''}`;
}

function buildCard(question, index) {
  const card = document.createElement('article');
  card.className = 'card question-card';

  const top = document.createElement('div');
  top.className = 'question-top';

  const number = document.createElement('span');
  number.className = 'question-number';
  number.textContent = String(index + 1);

  const prompt = document.createElement('p');
  prompt.className = 'prompt';
  prompt.textContent = question.prompt;

  top.append(number, prompt);

  // No autoplay: mobile browsers block it anyway, and a tap on the native
  // control is a valid user gesture.
  //
  // preload="metadata" rather than "auto" is deliberate. Every clip is on this
  // one page, so "auto" would pull all of them (several MB) the moment the page
  // opens -- rough on a phone over cellular. "metadata" fetches just enough to
  // show the duration, and the audio downloads when someone actually hits play.
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = question.audio;

  // Only one clip at a time. Hooked to the element's own "play" event rather
  // than to a click handler, so it also covers keyboard use of the native
  // controls and any other route into playback.
  //
  // Pausing the others can't loop back here: pause fires "pause", not "play".
  audio.addEventListener('play', () => stopAllAudio(question.id));

  const slot = document.createElement('div');
  slot.className = 'answer-slot';

  card.append(top, audio, slot);
  cards.set(question.id, { card, audio, slot });

  return card;
}

/**
 * Pause every clip, optionally sparing one.
 *
 * Browsers happily play any number of <audio> elements at once, and with all the
 * questions on a single page that means overlapping clips. Nothing enforces
 * one-at-a-time for us, so this does.
 */
function stopAllAudio(exceptId = null) {
  for (const [questionId, entry] of cards) {
    if (questionId === exceptId) continue;
    // Optional call: the element is real in a browser, stubbed in the tests.
    entry.audio?.pause?.();
  }
}

function buildList() {
  // Detaching a playing <audio> does not reliably stop it -- some browsers keep
  // an orphaned element sounding. Pause before discarding, or a restart leaves
  // the old clip playing over the new page.
  stopAllAudio();

  cards.clear();
  els.list.replaceChildren(...questions.map((question, i) => buildCard(question, i)));
  for (const question of questions) renderAnswerSlot(question);
}

function updateHeader() {
  const answered = answeredCount();

  els.progressLabel.textContent = `${answered} of ${questions.length} answered`;
  els.scoreLabel.textContent = `${totalScore()} / ${maxScore} pts`;
  els.progressFill.style.width = `${(answered / questions.length) * 100}%`;
}

function updateDonePanel() {
  const complete = answeredCount() === questions.length;

  els.donePanel.hidden = !complete;
  if (!complete) return;

  els.finalScore.textContent = `${totalScore()} / ${maxScore}`;
  els.doneNote.textContent = isConfigured
    ? 'Your answers are saved. Thanks — this is exactly what I needed.'
    : 'Firebase isn’t configured, so this score stayed in your browser.';
}

function render() {
  if (!state.username) {
    show('login');
    els.usernameInput.focus();
    return;
  }

  show('quiz');
  buildList();
  updateHeader();
  updateDonePanel();
}

// ----------------------------------------------------------------- actions

function submitAnswer(question, form) {
  const result = {};

  for (const field of question.fields) {
    const raw = (form.elements[field.key].value || '').trim();
    result[field.key] = { raw, matched: isMatch(raw, field.accept) };
  }

  state.results[question.id] = result;

  persist();
  sync();

  // Submitting deliberately does NOT stop the clip -- clips play to the end and
  // people stop them with the native control if they want to.

  // Only this card changes; the others keep their state and their audio.
  renderAnswerSlot(question);
  updateHeader();

  const wasComplete = !els.donePanel.hidden;
  updateDonePanel();

  // Nudge the summary into view the moment the last question lands, since on a
  // long page it would otherwise be offscreen.
  if (!wasComplete && !els.donePanel.hidden) {
    els.donePanel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
}

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = els.usernameInput.value.trim();
  if (!name) return;

  state.username = name;
  persist();
  render();
});

els.restart.addEventListener('click', () => {
  // Keeps the name: restarting under the same id overwrites that leaderboard
  // row rather than adding a duplicate.
  state.results = {};

  persist();
  sync();
  render();
});

// -------------------------------------------------------------- bootstrap

els.title.textContent = ROUND_TITLE;
els.blurb.textContent = ROUND_BLURB;
els.quizTitle.textContent = ROUND_TITLE;
els.quizBlurb.textContent = ROUND_BLURB;
document.title = ROUND_TITLE;

if (!isConfigured) els.banner.hidden = false;

loadState();
render();
