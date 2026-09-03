// Fuzzy answer matching.
//
// The quiz auto-scores free-text answers, so this file decides who gets a point.
// Two competing risks: too strict and real answers get marked wrong; too loose
// and everything scores. The safety net is that app.js stores the raw typed text
// regardless, so anything mis-scored here is still recoverable by eye on the
// leaderboard.

// Trailing release-label noise that shouldn't affect a match.
const NOISE_SUFFIX =
  /\s+(remastered|remaster|live|radio edit|single version|album version|explicit)$/;

const LEADING_ARTICLE = /^(the|a|an)\s+/;

/**
 * Reduce an answer to a comparable core string.
 * "Beyoncé's (Remastered)" -> "beyonces"
 */
export function normalize(value) {
  if (value == null) return '';

  let text = String(value);

  // Split accented chars into base + combining mark, then drop the marks, so
  // "Beyoncé" and "Beyonce" converge.
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  text = text.toLowerCase();

  // Parentheticals are nearly always annotations, not part of the title.
  text = text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

  // "Simon & Garfunkel" vs "Simon and Garfunkel".
  text = text.replace(/&/g, ' and ');

  // Apostrophes vanish rather than becoming spaces, so "don't" -> "dont"
  // instead of "don t".
  text = text.replace(/['‘’`]/g, '');

  // Any other punctuation becomes a separator.
  text = text.replace(/[^a-z0-9]+/g, ' ');
  text = text.trim().replace(/\s+/g, ' ');

  text = text.replace(LEADING_ARTICLE, '');
  text = text.replace(NOISE_SUFFIX, '');

  return text.trim();
}

/** Standard Levenshtein edit distance, two-row variant. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1, // deletion
        cur[j - 1] + 1, // insertion
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
    prev = cur;
  }

  return prev[b.length];
}

// How many typos to forgive, scaled by length.
//
// Short answers get zero slack. Allowing even one edit at five characters makes
// real band names collide: Wings/Kings and Slade/Shade are each one edit apart.
// Little is lost by refusing, because the usual typo in a short word is a
// transposition, which costs 2 and so wouldn't have been forgiven anyway.
function editBudget(length) {
  if (length <= 5) return 0;
  if (length <= 9) return 1;
  if (length <= 14) return 2;
  return 3;
}

// Containment catches "its bohemian rhapsody" for "Bohemian Rhapsody", but
// unguarded it would also let "rhap" through. Both strings must be substantial
// and of comparable length.
const MIN_CONTAINMENT_LENGTH = 6;
const MIN_CONTAINMENT_RATIO = 0.6;

function contains(guess, answer) {
  if (!guess.includes(answer) && !answer.includes(guess)) return false;

  const shorter = Math.min(guess.length, answer.length);
  const longer = Math.max(guess.length, answer.length);

  return shorter >= MIN_CONTAINMENT_LENGTH && shorter / longer >= MIN_CONTAINMENT_RATIO;
}

/**
 * Does `input` count as any of `acceptList`?
 * @param {string} input       what the player typed
 * @param {string[]} acceptList accepted answers and their aliases
 */
export function isMatch(input, acceptList) {
  const guess = normalize(input);
  if (!guess) return false;

  for (const candidate of acceptList || []) {
    const answer = normalize(candidate);
    if (!answer) continue;

    if (guess === answer) return true;
    if (contains(guess, answer)) return true;
    if (levenshtein(guess, answer) <= editBudget(answer.length)) return true;
  }

  return false;
}
