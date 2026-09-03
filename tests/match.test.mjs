// Run: node tests/match.test.mjs
//
// The point of these tests is symmetry: a matcher that passes only the "should
// match" cases is trivially satisfied by `return true`. The rejection cases are
// what actually pin the behaviour down.

import { normalize, levenshtein, isMatch } from '../assets/match.js';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(`${label}\n    expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function shouldMatch(input, accept) {
  check(`MATCH  ${JSON.stringify(input)} ~ ${JSON.stringify(accept)}`, isMatch(input, accept), true);
}

function shouldReject(input, accept) {
  check(`REJECT ${JSON.stringify(input)} ~ ${JSON.stringify(accept)}`, isMatch(input, accept), false);
}

// ---------------------------------------------------------------- normalize

check('normalize lowercases', normalize('QUEEN'), 'queen');
check('normalize strips diacritics', normalize('Beyoncé'), 'beyonce');
check('normalize strips leading "the"', normalize('The Beatles'), 'beatles');
check('normalize strips apostrophes tightly', normalize("Don't Stop"), 'dont stop');
check('normalize expands ampersand', normalize('Simon & Garfunkel'), 'simon and garfunkel');
check('normalize drops parentheticals', normalize('Alive (Remastered)'), 'alive');
check('normalize drops noise suffix', normalize('Alive - Remastered'), 'alive');
check('normalize collapses whitespace', normalize('  a   b  '), 'b'); // "a " is a leading article
check('normalize handles null', normalize(null), '');
check('normalize handles punctuation-only', normalize('!!!'), '');

// -------------------------------------------------------------- levenshtein

check('levenshtein identical', levenshtein('abc', 'abc'), 0);
check('levenshtein empty', levenshtein('', 'abc'), 3);
check('levenshtein substitution', levenshtein('abc', 'abd'), 1);
check('levenshtein transposition costs 2', levenshtein('ab', 'ba'), 2);

// ------------------------------------------------------- accepted variations

const RHAPSODY = ['Bohemian Rhapsody'];

shouldMatch('Bohemian Rhapsody', RHAPSODY); // exact
shouldMatch('bohemian rhapsody', RHAPSODY); // case
shouldMatch('  Bohemian   Rhapsody  ', RHAPSODY); // whitespace
shouldMatch('Bohemian Rhapsdoy', RHAPSODY); // transposed letters
shouldMatch('Bohemian Rhapsody!', RHAPSODY); // punctuation
shouldMatch('THE BOHEMIAN RHAPSODY', RHAPSODY); // leading article
shouldMatch('its bohemian rhapsody', RHAPSODY); // prefixed chatter
shouldMatch('Bohemian Rhapsody (Remastered)', RHAPSODY); // parenthetical

shouldMatch('Beyonce', ['Beyoncé']); // missing accent
shouldMatch('Beyoncé', ['Beyonce']); // accent when none expected
shouldMatch('The Beatles', ['Beatles']); // article on one side only
shouldMatch('Beatles', ['The Beatles']);
shouldMatch('Simon and Garfunkel', ['Simon & Garfunkel']);
shouldMatch('Dont Stop Believin', ["Don't Stop Believin'"]);
shouldMatch('Guns n Roses', ["Guns N' Roses"]);

// Aliases: the whole reason `accept` is an array.
shouldMatch('Puff Daddy', ['Diddy', 'Puff Daddy', 'P Diddy']);
shouldMatch('P. Diddy', ['Diddy', 'Puff Daddy', 'P Diddy']);

// ------------------------------------------------------------- must NOT pass

// Different answers entirely — the core failure mode to avoid.
shouldReject('Stairway to Heaven', RHAPSODY);
shouldReject('Queen', RHAPSODY);
shouldReject('Radio Ga Ga', ['Radio Gaga Goo']);

// Empty and junk input must never score.
shouldReject('', RHAPSODY);
shouldReject('   ', RHAPSODY);
shouldReject('!!!', RHAPSODY);
shouldReject(null, RHAPSODY);
shouldReject('anything', []);
shouldReject('anything', null);

// A fragment shouldn't earn the point.
shouldReject('rhap', RHAPSODY);
shouldReject('bohemian', RHAPSODY);

// Short answers get zero edit slack. These are real, distinct artists one edit
// apart — the cases that forced editBudget to refuse at five characters.
shouldReject('Wings', ['Kings']);
shouldReject('Slade', ['Shade']);
shouldReject('Bush', ['Rush']);
shouldReject('Queen', ['Quean']);
shouldReject('Pink', ['Ping']);

// Longer answers keep their slack, so genuine misspellings still score.
shouldMatch('Beetles', ['Beatles']);
shouldMatch('Nirvanna', ['Nirvana']);
shouldMatch('Fleetwood Mack', ['Fleetwood Mac']);

// Guessing one member of the pair shouldn't match the other field.
shouldReject('Freddie Mercury', RHAPSODY);

// --------------------------------------------------------------------- report

for (const failure of failures) console.error(`  FAIL ${failure}`);

const total = passed + failures.length;
console.log(`\n${passed}/${total} assertions passed`);

if (failures.length) {
  console.error(`${failures.length} failing`);
  process.exit(1);
}
