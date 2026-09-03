#!/usr/bin/env bash
#
# Cut quiz clips out of full-length tracks, at timestamps you choose.
#
#   brew install ffmpeg              # prerequisite
#   ./tools/make_clips.sh --dry-run  # validate the manifest, cut nothing
#   ./tools/make_clips.sh            # cut everything
#   ./tools/make_clips.sh --play     # cut, and play each one back as it's made
#   ./tools/make_clips.sh --only q01,q05
#
# Reads source/clips.txt. Full tracks live in source/, which is gitignored, so
# only the short cuts in audio/ ever reach the public repo.
#
# Written for bash 3.2 (what macOS ships) -- no associative arrays, no mapfile.

set -euo pipefail

MANIFEST="source/clips.txt"
DEFAULT_SECONDS=20     # Per-clip length can override this in the manifest.
BITRATE=128k           # ~1MB for 20s mono. Plenty over a phone speaker.
TARGET_LOUDNESS=-16    # LUFS. See the note by the ffmpeg call.
OUT_DIR="audio"

ONLY=""
PLAY=0
DRY_RUN=0

usage() {
  sed -n '2,17p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="$2"; shift 2 ;;
    --only)     ONLY="$2"; shift 2 ;;
    --play)     PLAY=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

# ---------------------------------------------------------------- helpers

trim() {
  # Strip leading/trailing whitespace. printf keeps it safe for odd filenames.
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Is this qid in the --only list? Always true when --only wasn't passed.
wanted() {
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ffmpeg accepts seconds or [hh:]mm:ss for -ss, so just check the shape.
valid_start() {
  printf '%s' "$1" | grep -Eq '^[0-9]+(:[0-9]{1,2}){0,2}(\.[0-9]+)?$'
}

if [ ! -f "$MANIFEST" ]; then
  cat >&2 <<EOF
No manifest at $MANIFEST

Create it with one line per question:

  # qid | source file | start | seconds | answer (for your reference)
  q01 | source/boasty.m4a | 1:47 | 14 | Idris Elba
  q02 | source/party-all-the-time.mp3 | 0:42 |    | Eddie Murphy

  start    seconds (90) or mm:ss (1:30) -- whatever your player shows
  seconds  clip length; blank uses the default of ${DEFAULT_SECONDS}s
  answer   ignored by this script, just so the file reads as documentation
EOF
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ] && ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it with:  brew install ffmpeg" >&2
  echo "(or re-run with --dry-run to validate the manifest without cutting)" >&2
  exit 1
fi

# ------------------------------------------------------- pass 1: validate
#
# Everything is checked before anything is cut, so a typo on line 9 doesn't
# leave you with clips 1-8 done and the rest missing.

PROBLEMS=0
SEEN_IDS=""
PLANNED=0

while IFS='|' read -r raw_qid raw_src raw_start raw_secs raw_answer || [ -n "$raw_qid" ]; do
  qid=$(trim "${raw_qid:-}")
  [ -z "$qid" ] && continue
  case "$qid" in \#*) continue ;; esac

  src=$(trim "${raw_src:-}")
  start=$(trim "${raw_start:-}")
  secs=$(trim "${raw_secs:-}")

  if ! printf '%s' "$qid" | grep -Eq '^q[0-9]+$'; then
    echo "  BAD  '$qid': qid should look like q01" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi

  case " $SEEN_IDS " in
    *" $qid "*) echo "  BAD  $qid: listed more than once" >&2; PROBLEMS=$((PROBLEMS + 1)); continue ;;
  esac
  SEEN_IDS="$SEEN_IDS $qid"

  if [ -z "$src" ]; then
    echo "  BAD  $qid: no source file given" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi
  if [ ! -f "$src" ]; then
    echo "  BAD  $qid: source file not found -> $src" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi
  if [ -z "$start" ] || ! valid_start "$start"; then
    echo "  BAD  $qid: start '$start' should be seconds (90) or mm:ss (1:30)" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi
  if [ -n "$secs" ] && ! printf '%s' "$secs" | grep -Eq '^[0-9]+$'; then
    echo "  BAD  $qid: seconds '$secs' should be a whole number, or blank" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi
  if [ -n "$secs" ] && [ "$secs" -lt 3 ]; then
    echo "  BAD  $qid: ${secs}s is too short to be a fair clip" >&2
    PROBLEMS=$((PROBLEMS + 1)); continue
  fi

  wanted "$qid" && PLANNED=$((PLANNED + 1))
done < "$MANIFEST"

if [ "$PROBLEMS" -gt 0 ]; then
  echo >&2
  echo "$PROBLEMS problem(s) in $MANIFEST -- nothing was cut." >&2
  exit 1
fi

if [ "$PLANNED" -eq 0 ]; then
  echo "Nothing to do." >&2
  [ -n "$ONLY" ] && echo "No manifest entry matched --only '$ONLY'." >&2
  exit 1
fi

echo "Manifest OK. $PLANNED clip(s) to cut."
[ "$DRY_RUN" -eq 1 ] && echo "(dry run -- stopping here)"
echo

# ---------------------------------------------------------- pass 2: cut

WROTE=0

while IFS='|' read -r raw_qid raw_src raw_start raw_secs raw_answer || [ -n "$raw_qid" ]; do
  qid=$(trim "${raw_qid:-}")
  [ -z "$qid" ] && continue
  case "$qid" in \#*) continue ;; esac
  wanted "$qid" || continue

  src=$(trim "${raw_src:-}")
  start=$(trim "${raw_start:-}")
  secs=$(trim "${raw_secs:-}")
  answer=$(trim "${raw_answer:-}")
  [ -z "$secs" ] && secs="$DEFAULT_SECONDS"

  out="$OUT_DIR/$qid.mp3"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  %-5s %-8s %3ss  <- %s%s\n' "$qid" "$start" "$secs" "$src" \
      "$([ -n "$answer" ] && printf '  (%s)' "$answer")"
    continue
  fi

  mkdir -p "$OUT_DIR"

  # Loudness normalisation is the important bit: tracks mastered decades apart
  # differ enormously in level, and without it testers spend the round riding
  # the volume instead of thinking about the question.
  #
  # -ss before -i seeks fast. Mono halves the size and costs nothing on a phone
  # speaker. The out-fade starts 1s before the end so clips don't just stop.
  # -nostdin matters: without it ffmpeg swallows the manifest this loop is
  # reading from, and only the first clip gets cut.
  fade_out_at=$((secs - 1))
  ffmpeg -hide_banner -loglevel error -nostdin \
    -ss "$start" -t "$secs" -i "$src" \
    -af "loudnorm=I=${TARGET_LOUDNESS}:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st=${fade_out_at}:d=1" \
    -ac 1 -b:a "$BITRATE" \
    -y "$out"

  size=$(du -h "$out" | cut -f1 | tr -d ' ')
  printf '  %-5s %-8s %3ss  %-6s %s\n' "$qid" "$start" "$secs" "$size" \
    "$([ -n "$answer" ] && printf '(%s)' "$answer")"
  WROTE=$((WROTE + 1))

  if [ "$PLAY" -eq 1 ]; then
    if command -v afplay >/dev/null 2>&1; then
      afplay "$out" || true
    else
      echo "       (afplay not available, skipping playback)"
    fi
  fi
done < "$MANIFEST"

[ "$DRY_RUN" -eq 1 ] && exit 0

echo
echo "Wrote $WROTE clip(s) to $OUT_DIR/"
echo
echo "Paths for assets/quiz-data.js:"
while IFS='|' read -r raw_qid rest || [ -n "$raw_qid" ]; do
  qid=$(trim "${raw_qid:-}")
  [ -z "$qid" ] && continue
  case "$qid" in \#*) continue ;; esac
  printf "  %-5s  audio: '%s/%s.mp3',\n" "$qid" "$OUT_DIR" "$qid"
done < "$MANIFEST"
echo
echo "Then: python3 tests/check_wiring.py   # confirms every path resolves"
