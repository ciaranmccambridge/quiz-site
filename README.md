# Quiz site - music round

A throwaway static site for pressure-testing a pub-quiz music round before running it in person.
People enter a name, then get every clip on one scrolling page. They name the artist for each,
the correct answer is revealed immediately, and everything they typed lands on a shared
leaderboard. Questions can be answered in any order.

No build step, no framework, no `npm install`. Plain HTML/CSS/JS on GitHub Pages, with Firebase
Firestore as the only shared storage.

**The point isn't the leaderboard.** It's the per-question answer breakdown at
`/leaderboard`, which shows every answer exactly as it was typed. That's what tells you which
questions to keep and which to bin.

---

## Quick start

```bash
npm run serve          # http://localhost:8765
npm test               # matcher + end-to-end flow + wiring checks
```

The site works fully without Firebase - you just get no shared leaderboard, and a banner saying so.
Build and tune the round first; wire up Firebase last.

---

## Writing your round

Everything you edit is in **`assets/quiz-data.js`**. One question looks like:

```js
{
  id: 'q01',
  audio: 'audio/q01.mp3',
  prompt: 'Name the artist.',
  fields: [{ key: 'artist', label: 'Artist', accept: ['Queen'] }],
}
```

- **Each question is worth 1 point**, and asks for the artist only.
- **`QUESTIONS_SHOWN`** at the top of the file sets how many questions the round uses, counting from
  the top of the list. Set it to 5 for a shorter round without deleting anything. Define more
  questions than you need and control the length from there. Asking for more than exist clamps to
  what's available and warns in the console.
- **`accept` is an array** - list every answer you'd allow out loud. Aliases, stage names, short
  forms.
- **Don't bother listing spelling variants.** The matcher already handles case, punctuation,
  accents, a leading "The", `&` vs "and", and small typos. Use `accept` only for genuinely
  different names.
- **`SESSION_ID`** namespaces the results. Bump it to start a clean run after testing with fake
  names.

Reload the page after editing. Nothing to rebuild.

### How answers are marked

`assets/match.js` normalises both sides then accepts an exact match, a small typo budget scaled to
length, or one string containing the other. Deliberate limits:

- Answers of five characters or fewer get **zero** typo tolerance, because real band names collide
  at that length (Wings/Kings, Slade/Shade are each one edit apart).
- **Short fragments don't score**: "guns" won't match "Guns N' Roses", "cran" won't match "The
  Cranberries".
- **Substantial fragments do.** "fleetwood" scores against "Fleetwood Mac" — it's 69% of the answer,
  and containment accepts anything that's at least 60% of the string and 6+ characters. That's
  usually what you want for a pub quiz, but if you'd rather demand the full name, raise
  `MIN_CONTAINMENT_RATIO` in `assets/match.js`.

If you change the matcher, run `npm test` — there are assertions for both what must match and what
must be rejected. The rejections are the important half.

Marking is imperfect by design, and that's survivable because **the raw text is always stored**. If
the matcher was too harsh on someone, you'll see it on the breakdown page and can score it by eye.

---

## Audio clips

The committed `audio/*.wav` files are **synthesised tones, not music** — placeholders so the site is
testable before you've cut anything. Each question has a different pitch, so if the player ever gets
stuck on one file you'll hear it immediately. Replace them with real clips before the quiz.

### Cutting real clips

Put the full-length tracks in **`source/`** (gitignored, so they never reach the public repo — only
the short cuts in `audio/` do), then list what you want in **`source/clips.txt`**:

```
# qid | source file                  | start | seconds | answer
q01   | source/boasty.m4a            | 1:47  | 14      | Idris Elba
q02   | source/party-all-the-time.mp3| 0:42  |         | Eddie Murphy
```

`start` takes seconds or `mm:ss`. `seconds` is per-clip and defaults to 20.

```bash
brew install ffmpeg                 # prerequisite
./tools/make_clips.sh --dry-run     # validate the manifest, cut nothing
./tools/make_clips.sh               # cut them all -> audio/qNN.mp3
./tools/make_clips.sh --play        # cut, and play each back as it's made
./tools/make_clips.sh --only q01    # re-cut one while tuning its timestamp
```

The manifest is validated in full before anything is cut, so a typo on line 9 doesn't leave you
with clips 1-8 done and the rest missing. Afterwards update the `audio:` paths in
`assets/quiz-data.js` (the script prints them) and delete the stale `.wav` placeholders.

**Per-clip length matters for cameos.** If the actor only appears for a few bars - Idris Elba on
*Boasty*, say - a 20-second clip starting at their verse runs past them into another vocalist and
hands over the wrong answer. Keep those tight.

**Loudness normalisation matters more than it sounds like it should.** Tracks mastered decades apart
differ hugely in level, and without it testers spend the round riding the volume instead of thinking
about the question. The script does this automatically.

**On sourcing:** to cut at your own timestamps you need the real file. Streaming previews are a
fixed window chosen by the label, so they cannot give you an arbitrary moment. DRM-free downloads
(iTunes Store, Amazon MP3, Bandcamp, 7digital) are ~£1 a track. A Spotify embed is no use either -
it displays the title and artist, which hands players the answer.

---

## Deploying to GitHub Pages

All paths are relative, so this works unchanged under any account, any repo name, at a subpath or a
domain root. Nothing to reconfigure.

1. Create a **public** repo on your personal account. Public is required for free-tier Pages.
2. Push it:
   ```bash
   git init && git add -A && git commit -m "Quiz site"
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
3. **Settings → Pages →** deploy from branch `main`, folder `/ (root)`.
4. Quiz: `https://<you>.github.io/<repo>/` — leaderboard: `.../<repo>/leaderboard`
   For a bare root URL, name the repo `<you>.github.io` instead.

### Firebase (needed for the shared leaderboard)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**. Skip
   Analytics.
2. **Build → Firestore Database → Create database**. Production mode; pick a region near your
   players (`europe-west2` for Belfast).
3. **Project settings → Your apps → Web (`</>`)**. Register the app and copy the `firebaseConfig`
   object.
4. Paste those values into `FIREBASE_CONFIG` in **`assets/firebase.js`**.
5. **Firestore → Rules**: paste `firestore.rules`, **change the expiry date** to a day or two after
   your quiz, and Publish.
6. Commit and push. Reload — the "Local mode" banner should be gone.

The Firebase config is safe to commit. Web API keys identify a project rather than authorising
access; security comes from the rules file. Publishing it is correct, not an oversight.

---

## Things to know before you share the link

- **The repo is public, so the answers are in the source.** Anyone who opens View Source or devtools
  can read them. There's no fixing that in a static site — the answers have to reach the browser
  somehow. Fine among coworkers doing you a favour; worth knowing before you share the link.
- **Anyone with the link can write to the leaderboard** while the rules window is open. That's what
  lets it work with no login.
- **Names aren't unique-checked.** Two people typing "Ciaran" share one row. Fine for a small group;
  ask people to use distinct names.
- **Progress survives a refresh** via `localStorage`, and syncs after every answer, so someone who
  drops out mid-round still leaves usable data.
- **Clips aren't preloaded.** All of them sit on one page, so `preload="metadata"` fetches only
  durations up front and the audio downloads when someone hits play. Otherwise opening the page
  would pull several MB, which is rough on a phone over cellular.
- **Only one clip plays at a time.** Starting one pauses the others. Browsers will happily overlap
  any number of `<audio>` elements, and with every question on one page that's the default outcome,
  so `app.js` enforces it via each element's `play` event.
- **Submitting doesn't stop the clip.** It plays to the end; people use the native control, or just
  start another one. Restart *does* stop everything, because a detached but still-playing `<audio>`
  would otherwise sound over a freshly rebuilt page with no control to stop it.

---

## Teardown

1. Delete the Firebase project: **Project settings → General → Delete project**.
2. Delete or privatise the GitHub repo.

The expiry date in `firestore.rules` closes the data window on its own even if you forget.

---

## Layout

```
index.html                  login + all questions on one page
leaderboard/index.html      live scores + per-question answer breakdown
assets/quiz-data.js         >>> THE FILE YOU EDIT <<<
assets/questions.js         validates and decodes the above
assets/match.js             fuzzy answer matching
assets/app.js               quiz flow
assets/leaderboard.js       live subscription + breakdown rendering
assets/firebase.js          >>> PASTE YOUR CONFIG HERE <<<
assets/styles.css           shared styles
audio/                      clips (placeholders until you replace them)
firestore.rules             paste into the Firebase console
tools/make_clips.sh         cuts clips per source/clips.txt (needs ffmpeg)
tests/check_wiring.py       catches typo'd DOM ids / bad imports / missing audio
tests/match.test.mjs        matcher assertions
tests/flow.test.mjs         end-to-end quiz flow, no browser needed
tests/leaderboard.test.mjs  ranking + answer breakdown, no browser needed
tests/dom-shim.mjs          minimal fake DOM shared by the two flow tests
```

`npm test` runs all four checks. Worth doing after editing questions, because it checks the data as
well as the code:

- No `accept` array is empty, and no entry normalises away to nothing (`'???'` would make a field
  unwinnable).
- No two *different* answers collide with each other under fuzzy matching — the signal that the
  matcher is too loose for your particular question set. Two questions legitimately sharing an
  artist is allowed.
- Question ids and audio paths are unique.

It deliberately does **not** assert that each answer matches its own field: a string always matches
a list containing itself, so that check passes regardless of how mangled the entry is.
