// ============================================================================
// THIS IS THE FILE YOU EDIT.
// ============================================================================
//
// Everything below is placeholder content so the site is testable immediately:
//   - The audio files are synthesised tones, not music.
//   - The artists below are examples chosen to demonstrate the answer format.
// Replace both with your real round.
//
// Each question asks for the artist only, and each is worth 1 point.
//
// `accept` is an ARRAY: list every answer you'd give a point for out loud.
// The matcher already handles case, punctuation, accents, a leading "The",
// "&" vs "and", and small typos -- so you do NOT need to list those variants.
// Use `accept` for genuinely different names: aliases, stage names, short forms.
//
// After editing, run `npm test` and reload the page. Nothing to rebuild.

// Bump this to start a fresh set of results (it becomes the Firestore path).
// Handy if you test with fake names first, then want a clean run for the real thing.
export const SESSION_ID = 'music-round-3';

// How many questions to actually use, taken from the top of QUESTIONS below.
// Set it to 5 to run a shorter round without deleting anything; set it to
// QUESTIONS.length (or higher) to use them all. Add more entries to QUESTIONS
// than you need and control the round length from here.
export const QUESTIONS_SHOWN = 12;

export const ROUND_TITLE = 'Music Round';
export const ROUND_BLURB =
  'Listen to each clip and name the Famous Actor who recorded the song. Answer them in any order - the correct answer ' +
  "appears as soon as you submit. Spelling doesn't have to be perfect.";

export const QUESTIONS = [
  {
    id: 'q01',
    audio: 'audio/q01-donald-glover.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Donald Glover', 'Childish Gambino'] }],
  },
  {
    id: 'q02',
    audio: 'audio/q02-michael-cera.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Michael Cera'] }],
  },
  {
    id: 'q03',
    audio: 'audio/q03-jamie-foxx.mp3',
    prompt: 'Name the actor.',
    fields: [
      { key: 'artist', label: 'Actor', accept: ['Jamie Foxx'] },
    ],
  },
  {
    id: 'q04',
    audio: 'audio/q04-jack-black.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Jack Black', 'Kyle Gass'] }],
  },
  {
    id: 'q05',
    audio: 'audio/q05-jackie-chan.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Jackie Chan'] }],
  },
  {
    id: 'q06',
    audio: 'audio/q06-idris-elba.mp3',
    prompt: 'Name the actor.',
    fields: [
      { key: 'artist', label: 'Actor', accept: ["Idris Elba"] },
    ],
  },
  {
    id: 'q07',
    audio: 'audio/q07-hugh-laurie.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Hugh Laurie'] }],
  },
  {
    id: 'q08',
    audio: 'audio/q08-tim-curry.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Tim Curry'] }],
  },
  {
    id: 'q09',
    audio: 'audio/q09-tom-hardy.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Tom Hardy'] }],
  },
  {
    id: 'q10',
    audio: 'audio/q10-christopher-lee.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Christopher Lee'] }],
  },
  {
    id: 'q11',
    audio: 'audio/q11-eddie-murphy.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Eddie Murphy'] }],
  },
  {
    id: 'q12',
    audio: 'audio/q12-jeff-bridges.mp3',
    prompt: 'Name the actor.',
    fields: [{ key: 'artist', label: 'Actor', accept: ['Jeff Bridges'] }],
  }
];
