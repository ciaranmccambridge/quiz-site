#!/usr/bin/env bash
#
# Cut a single quiz clip, no manifest needed.
#
#   brew install ffmpeg     # prerequisite
#   ./tools/make_clip.sh source/boasty.m4a 1:47 14 q01
#   ./tools/make_clip.sh source/boasty.m4a 1:47 14 q01 --play
#
# Writes audio/<name>.mp3. For a whole round at once, use make_clips.sh
# with source/clips.txt instead.

set -euo pipefail

DEFAULT_SECONDS=20     # used if seconds is left blank ("")
BITRATE=128k           # ~1MB for 20s mono. Plenty over a phone speaker.
TARGET_LOUDNESS=-16    # LUFS. See the note by the ffmpeg call.
OUT_DIR="audio"

usage() {
  sed -n '2,9p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'
  exit "${1:-0}"
}

PLAY=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --play) PLAY=1 ;;
    -h|--help) usage 0 ;;
    *) ARGS+=("$a") ;;
  esac
done

if [ "${#ARGS[@]}" -lt 4 ]; then
  echo "usage: $0 <source> <start> <seconds> <name> [--play]" >&2
  echo "  source    path to the full-length track" >&2
  echo "  start     seconds (90) or mm:ss (1:30)" >&2
  echo "  seconds   clip length; blank (\"\") uses the default of ${DEFAULT_SECONDS}s" >&2
  echo "  name      output name, no extension -> $OUT_DIR/<name>.mp3" >&2
  exit 1
fi

src="${ARGS[0]}"
start="${ARGS[1]}"
secs="${ARGS[2]}"
name="${ARGS[3]}"

[ -z "$secs" ] && secs="$DEFAULT_SECONDS"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it with:  brew install ffmpeg" >&2
  exit 1
fi

if [ ! -f "$src" ]; then
  echo "source file not found -> $src" >&2
  exit 1
fi

# ffmpeg accepts seconds or [hh:]mm:ss for -ss, so just check the shape.
if ! printf '%s' "$start" | grep -Eq '^[0-9]+(:[0-9]{1,2}){0,2}(\.[0-9]+)?$'; then
  echo "start '$start' should be seconds (90) or mm:ss (1:30)" >&2
  exit 1
fi

if ! printf '%s' "$secs" | grep -Eq '^[0-9]+$'; then
  echo "seconds '$secs' should be a whole number, or blank" >&2
  exit 1
fi
if [ "$secs" -lt 3 ]; then
  echo "${secs}s is too short to be a fair clip" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
out="$OUT_DIR/$name.mp3"

# Loudness normalisation is the important bit: tracks mastered decades apart
# differ enormously in level, and without it testers spend the round riding
# the volume instead of thinking about the question.
#
# -ss before -i seeks fast. Mono halves the size and costs nothing on a phone
# speaker. The out-fade starts 1s before the end so the clip doesn't just stop.
fade_out_at=$((secs - 1))
ffmpeg -hide_banner -loglevel error -nostdin \
  -ss "$start" -t "$secs" -i "$src" \
  -af "loudnorm=I=${TARGET_LOUDNESS}:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st=${fade_out_at}:d=1" \
  -ac 1 -b:a "$BITRATE" \
  -y "$out"

size=$(du -h "$out" | cut -f1 | tr -d ' ')
echo "wrote $out ($size)"

if [ "$PLAY" -eq 1 ]; then
  if command -v afplay >/dev/null 2>&1; then
    afplay "$out" || true
  else
    echo "(afplay not available, skipping playback)"
  fi
fi
