#!/usr/bin/env bash
#
# How many streams can this machine compose?
#
# Encodes a synthetic grid with the same shape as the real pipeline —
# N × 720p30 inputs scaled into a 1080p30 canvas, libx264 ultrafast zerolatency —
# and reports the encoding speed relative to real time. Anything at or above
# 1.0x keeps up with live; below that, frames are dropped.
#
#   ./scripts/benchmark.sh                    # 1,2,4,6,9,12,16 sources
#   ./scripts/benchmark.sh --counts 4,9       # only these
#   ./scripts/benchmark.sh --duration 30      # longer, more accurate
#   ./scripts/benchmark.sh --preset veryfast --bitrate 6000
#
# With no local ffmpeg, run it through the image instead:
#   docker run --rm -v "$PWD/scripts:/s" ghcr.io/slicit/stream-composer /s/benchmark.sh

set -euo pipefail

COUNTS="1,2,4,6,9,12,16"
DURATION=15
PRESET="ultrafast"
BITRATE=4500
WIDTH=1920
HEIGHT=1080
FPS=30
SRC_W=1280
SRC_H=720
SCALER="bilinear"
FFMPEG="${FFMPEG:-ffmpeg}"

while [ $# -gt 0 ]; do
  case "$1" in
    --counts) COUNTS="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --preset) PRESET="$2"; shift 2 ;;
    --bitrate) BITRATE="$2"; shift 2 ;;
    --width) WIDTH="$2"; shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --scaler) SCALER="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

command -v "$FFMPEG" >/dev/null 2>&1 || { echo "ffmpeg not found. Set FFMPEG=/path/to/ffmpeg." >&2; exit 1; }

cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo '?')"

# Containers and VMs often get a CPU quota well below the visible core count.
# Reporting the quota stops the verdict from looking inexplicably pessimistic.
allowance="$cores"
if [ -r /sys/fs/cgroup/cpu.max ]; then
  read -r q p < /sys/fs/cgroup/cpu.max || true
  if [ "${q:-max}" != "max" ] && [ -n "${p:-}" ]; then
    allowance="$(awk "BEGIN{printf \"%.2f\", $q / $p}")"
  fi
elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]; then
  q="$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)"
  p="$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)"
  if [ "$q" -gt 0 ] 2>/dev/null; then
    allowance="$(awk "BEGIN{printf \"%.2f\", $q / $p}")"
  fi
fi
model="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//' || echo 'unknown')"
mhz="$(grep -m1 'cpu MHz' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//' | cut -d. -f1 || echo '?')"

# A faithful benchmark has to decode real H.264, because decoding N incoming
# streams is a material share of the cost — synthetic filter sources would
# flatter the result badly. So: encode one short clip up front, then loop it as
# each input.
CLIP="$(mktemp -d)/source-720p.mp4"
trap 'rm -rf "$(dirname "$CLIP")"' EXIT

echo
echo "Stream Composer capacity benchmark"
echo "  CPU         ${model}"
echo "  Cores       ${cores}   (~${mhz} MHz reported)"
if [ "$allowance" != "$cores" ]; then
  echo "  Allowance   ${allowance} cores  (this container is capped below its visible core count)"
fi
echo "  ffmpeg      $("$FFMPEG" -hide_banner -version | head -1)"
echo "  Sources     ${SRC_W}x${SRC_H}@${FPS}  →  output ${WIDTH}x${HEIGHT}@${FPS} ${BITRATE}k, preset ${PRESET}"
echo "  Sample      ${DURATION}s per run"
echo

printf 'Preparing a %sx%s H.264 test clip… ' "$SRC_W" "$SRC_H"
"$FFMPEG" -hide_banner -loglevel error -nostdin \
  -f lavfi -i "testsrc2=size=${SRC_W}x${SRC_H}:rate=${FPS}" \
  -t 10 -c:v libx264 -preset veryfast -tune zerolatency -profile:v high \
  -b:v 3000k -g "$((FPS * 2))" -pix_fmt yuv420p -y "$CLIP"
echo "done."
echo

printf '  %-9s %-9s %-10s %-9s %-8s %s\n' "SOURCES" "GRID" "SPEED" "CPU TIME" "LOAD" "VERDICT"
printf '  %s\n' "------------------------------------------------------------------"

# Even, floored division helper.
even() { echo $(( ($1 / 2) * 2 )); }

max_ok=0
costs=""

for n in ${COUNTS//,/ }; do
  cols=1
  while [ $((cols * cols)) -lt "$n" ]; do cols=$((cols + 1)); done
  rows=$(( (n + cols - 1) / cols ))

  cell_w=$(even $(( (WIDTH - 4 * (cols + 1)) / cols )))
  cell_h=$(even $(( (HEIGHT - 4 * (rows + 1)) / rows )))

  inputs=""
  filter="color=c=0x0b1220:s=${WIDTH}x${HEIGHT}:r=${FPS}[bg];"
  for i in $(seq 0 $((n - 1))); do
    inputs="$inputs -stream_loop -1 -i $CLIP"
    filter="${filter}[${i}:v]fps=${FPS},scale=${cell_w}:${cell_h}:force_original_aspect_ratio=decrease:flags=${SCALER},pad=${cell_w}:${cell_h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[c${i}];"
  done

  last="bg"
  for i in $(seq 0 $((n - 1))); do
    r=$(( i / cols )); c=$(( i % cols ))
    x=$(( 4 + c * (cell_w + 4) )); y=$(( 4 + r * (cell_h + 4) ))
    if [ "$i" -eq $((n - 1)) ]; then out="stacked"; else out="o${i}"; fi
    filter="${filter}[${last}][c${i}]overlay=x=${x}:y=${y}[${out}];"
    last="$out"
  done
  filter="${filter}[${last}]format=yuv420p[outv]"

  start=$(date +%s.%N)
  # shellcheck disable=SC2086
  output="$("$FFMPEG" -hide_banner -loglevel info -nostdin -benchmark \
      $inputs \
      -filter_complex "$filter" -map '[outv]' -an \
      -c:v libx264 -preset "$PRESET" -tune zerolatency -profile:v high \
      -b:v "${BITRATE}k" -maxrate "${BITRATE}k" -bufsize "$((BITRATE * 2))k" \
      -g "$((FPS * 2))" -r "$FPS" \
      -t "$DURATION" -f null - 2>&1 || true)"
  end=$(date +%s.%N)

  wall=$(awk "BEGIN{printf \"%.2f\", $end - $start}")
  speed=$(awk "BEGIN{printf \"%.2f\", $DURATION / ($end - $start)}")
  utime="$(printf '%s' "$output" | grep -o 'utime=[0-9.]*' | tail -1 | cut -d= -f2 || true)"
  [ -n "$utime" ] || utime="?"
  if [ "$utime" != "?" ]; then
    load=$(awk "BEGIN{printf \"%.0f%%\", ($utime / $wall) * 100 / $allowance}")
    # Core-seconds of work per second of output — the number that transfers to
    # other hardware, unlike wall-clock speed on this particular box.
    cost=$(awk "BEGIN{printf \"%.3f\", $utime / $DURATION}")
    costs="$costs $n:$cost"
  else
    load="?"
  fi

  if awk "BEGIN{exit !($speed >= 1.25)}"; then
    verdict="comfortable"
    max_ok=$n
  elif awk "BEGIN{exit !($speed >= 1.0)}"; then
    verdict="at the limit"
    max_ok=$n
  else
    verdict="TOO SLOW"
  fi

  printf '  %-9s %-9s %-10s %-9s %-8s %s\n' "$n" "${cols}x${rows}" "${speed}x" "${utime}s" "$load" "$verdict"
done

echo
if [ "$max_ok" -gt 0 ]; then
  echo "  This machine sustains about ${max_ok} sources at ${WIDTH}x${HEIGHT}@${FPS}, preset ${PRESET}."
  echo "  Leave headroom for reconnects and viewer traffic: plan for around $(( max_ok * 7 / 10 ))."
else
  echo "  Even a single source could not keep up. Try a lower output resolution,"
  echo "  a lower frame rate, or hardware encoding."
fi

# Fit cost = base + per_source * N over the samples. This transfers to other
# hardware far better than the wall-clock speed above.
if [ -n "$costs" ]; then
  echo
  echo "$costs" | tr ' ' '\n' | grep -v '^$' | awk -F: '
    { n[NR]=$1; c[NR]=$2; sx+=$1; sy+=$2; sxx+=$1*$1; sxy+=$1*$2; count++ }
    END {
      if (count < 2) exit
      slope = (count*sxy - sx*sy) / (count*sxx - sx*sx)
      base  = (sy - slope*sx) / count
      printf "  Measured cost model on this CPU (core-seconds per second of output):\n"
      printf "    total ≈ %.2f + %.3f × sources\n", base, slope
      printf "    i.e. the encoder and canvas cost about %.2f of a core, and each\n", base
      printf "    additional source adds roughly %.0f%% of a core to decode and scale.\n", slope*100
    }'
fi
echo
