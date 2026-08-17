#!/usr/bin/env bash
#
# Capture the documentation screenshots from a real, running instance.
#
# Boots a throwaway Stream Composer against a throwaway MediaMTX on high ports,
# publishes synthetic sources into it, drives a headless browser over the real
# pages, and writes the results to docs/screenshots/.
#
# Needs: node, ffmpeg, a mediamtx binary, playwright (npm i -g playwright),
# and optionally python3 + Pillow to trim and shrink the results.
#
#   ./scripts/screenshots.sh
#   ./scripts/screenshots.sh --mediamtx ~/bin/mediamtx --keep
#
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/screenshots"
WORK="$(mktemp -d)"
MEDIAMTX="${MEDIAMTX:-mediamtx}"
KEEP=0

# High ports, so this never collides with a real deployment on the same box.
PORT=13222
API_PORT=19997
RTMP_PORT=11935
RTSP_PORT=18554
HLS_PORT=18888
WEBRTC_PORT=18889
WEBRTC_UDP=18189
# Stands in for a streaming platform, so one row on the Restream tab is
# genuinely carrying rather than merely configured.
SINK_PORT=11940
SECRET=screenshot-internal-secret
PASSWORD='demo-Passw0rd!'

while [ $# -gt 0 ]; do
  case "$1" in
    --mediamtx) MEDIAMTX="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  sleep 1
  for pid in "${PIDS[@]:-}"; do kill -9 "$pid" 2>/dev/null || true; done
  if [ "$KEEP" -eq 1 ]; then
    echo "working directory kept at $WORK"
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }
need node
need ffmpeg
command -v "$MEDIAMTX" >/dev/null 2>&1 || [ -x "$MEDIAMTX" ] || {
  echo "missing: mediamtx (pass --mediamtx /path/to/mediamtx)" >&2
  exit 1
}

PLAYWRIGHT="$(node -e 'try{console.log(require.resolve("playwright"))}catch(e){process.exit(1)}' 2>/dev/null || true)"
[ -n "$PLAYWRIGHT" ] || {
  echo "missing: playwright — npm install -g playwright" >&2
  exit 1
}

mkdir -p "$WORK/data" "$WORK/logs" "$OUT"

# ---------------------------------------------------------------- demo content

cat > "$WORK/seed.js" <<EOF
process.env.DATA_DIR = '$WORK/data';
process.env.LOG_DIR = '$WORK/logs';
const store = require('$ROOT/server/src/store');
const auth = require('$ROOT/server/src/auth');
const streams = require('$ROOT/server/src/streams');
store.load();
auth.createUser({ username: 'admin', password: '$PASSWORD', role: 'admin' });
auth.createUser({ username: 'producer', password: '$PASSWORD', role: 'admin' });
auth.createUser({ username: 'gallery', password: '$PASSWORD', role: 'viewer' });
for (const d of [
  { name: 'Studio A', nickname: 'Main Stage', note: 'Blackmagic ATEM feed' },
  { name: 'Studio B', nickname: 'Drum Cam' },
  { name: 'Roaming', nickname: 'Roaming Cam', note: 'Handheld, wireless' },
  { name: 'Slides', nickname: 'Presenter Slides' },
]) streams.create(d);
store.update((d) => { d.composition.labels = true; d.composition.labelSize = 28; });

// Restream destinations for the Restream tab. The platform ones are seeded
// switched off on purpose — they carry plausible-looking keys, and a capture
// run must never open a connection to somebody's real Twitch or YouTube
// ingest. The local one points at the sink started below, so the tab shows a
// destination that is actually carrying, with real byte and rate figures.
const relays = require('$ROOT/server/src/relays');
const byName = (n) => store.get().streams.find((s) => s.name === n).id;
for (const d of [
  { streamId: byName('Studio A'), provider: 'custom', url: 'rtmp://127.0.0.1:$SINK_PORT/live', key: 'demo', name: 'Local RTMP destination', enabled: true },
  { streamId: byName('Studio A'), provider: 'twitch', name: 'Twitch — main channel', key: 'live_284461337_9fQx2LmZaKpRb7Yn', enabled: false },
  { streamId: byName('Studio A'), provider: 'youtube', name: 'YouTube — main channel', key: 'a4kd-8xz1-mn0p-7yqw-3hbt', enabled: false },
  { streamId: byName('Studio A'), provider: 'youtube-backup', name: 'YouTube — backup ingest', key: 'a4kd-8xz1-mn0p-7yqw-3hbt', enabled: false },
  { streamId: byName('Slides'), provider: 'custom', url: 'rtmp://archive.example.com/record', name: 'Archive recorder', key: 'slides-2024', enabled: false },
]) relays.create(d);
EOF
node "$WORK/seed.js" > /dev/null

# --------------------------------------------------------------------- mediamtx

sed \
  -e "s#^apiAddress:.*#apiAddress: 127.0.0.1:$API_PORT#" \
  -e "s#^rtmpAddress:.*#rtmpAddress: 127.0.0.1:$RTMP_PORT#" \
  -e "s#^rtspAddress:.*#rtspAddress: 127.0.0.1:$RTSP_PORT#" \
  -e "s#^hlsAddress:.*#hlsAddress: 127.0.0.1:$HLS_PORT#" \
  -e "s#^webrtcAddress:.*#webrtcAddress: 127.0.0.1:$WEBRTC_PORT#" \
  -e "s#^webrtcLocalUDPAddress:.*#webrtcLocalUDPAddress: 127.0.0.1:$WEBRTC_UDP#" \
  -e "s#^srt:.*#srt: no#" \
  -e "s#^authHTTPAddress:.*#authHTTPAddress: http://127.0.0.1:$PORT/internal/$SECRET/mediamtx/auth#" \
  "$ROOT/config/mediamtx.yml" > "$WORK/mediamtx.yml"

# Run it from the work directory: MediaMTX drops a self-signed key pair
# beside its working directory, and that should not land in the repo.
(cd "$WORK" && exec "$MEDIAMTX" "$WORK/mediamtx.yml") > "$WORK/mediamtx.log" 2>&1 &
PIDS+=($!)

# ----------------------------------------------------------------------- server

# ffmpeg shim used for the viewer pass only. Headless Chromium is built without
# proprietary codecs, so it cannot decode the H.264 programme and the player
# would show its "this browser cannot play the stream" notice instead of a
# picture. Swapping only the output codec for VP8 keeps every other part of the
# pipeline — layout, labels, ingest, WHEP, the UI — exactly as shipped.
cat > "$WORK/ffmpeg-vp8" <<'EOF'
#!/usr/bin/env node
const { spawn } = require('child_process');
const VP8 = ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '16', '-pix_fmt', 'yuv420p',
  '-r', '30', '-g', '60', '-b:v', '3000k', '-maxrate', '3000k', '-bufsize', '6000k',
  '-error-resilient', '1', '-auto-alt-ref', '0'];
const argv = process.argv.slice(2);
const out = [];
let skipping = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-c:v' && argv[i + 1] === 'libx264') { skipping = true; out.push(...VP8); i += 1; continue; }
  if (skipping) { if (argv[i] === '-fps_mode') skipping = false; else continue; }
  out.push(argv[i]);
}
const child = spawn(process.env.REAL_FFMPEG || 'ffmpeg', out, { stdio: 'inherit' });
// Forward termination, or the compositor's SIGTERM kills only this wrapper and
// the real ffmpeg keeps holding the programme path against overridePublisher.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch (_) {} });
child.on('exit', (c) => process.exit(c === null ? 1 : c));
child.on('error', (e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
EOF
chmod +x "$WORK/ffmpeg-vp8"

SERVER_PID=""
start_server() { # $1 = ffmpeg binary to hand the compositor
  DATA_DIR="$WORK/data" LOG_DIR="$WORK/logs" PORT="$PORT" BIND_ADDRESS=127.0.0.1 \
  MEDIAMTX_API="http://127.0.0.1:$API_PORT" MEDIAMTX_RTMP="rtmp://127.0.0.1:$RTMP_PORT" \
  MEDIAMTX_WEBRTC="http://127.0.0.1:$WEBRTC_PORT" MEDIAMTX_HLS="http://127.0.0.1:$HLS_PORT" \
  MEDIAMTX_RTSP_PORT="$RTSP_PORT" \
  MEDIAMTX_INTERNAL_USER=composer MEDIAMTX_INTERNAL_PASSWORD="$SECRET" \
  RTMP_PUBLIC_HOST=stream.example.com PUBLIC_URL=https://stream.example.com \
  APP_VERSION="$(node -e "process.stdout.write(require('$ROOT/server/package.json').version || 'dev')" 2>/dev/null || echo dev)" \
  FFMPEG_PATH="$1" REAL_FFMPEG="$(command -v ffmpeg)" \
    node "$ROOT/server/src/index.js" > "$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  PIDS+=("$SERVER_PID")
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

wait_for() { # $1 = description, $2 = command
  for _ in $(seq 1 60); do
    if eval "$2" > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "timed out waiting for $1" >&2
  tail -20 "$WORK/server.log" >&2 || true
  exit 1
}

# -------------------------------------------------------------------- publishers

PUB_PIDS=()
stop_publishers() {
  for pid in "${PUB_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  PUB_PIDS=()
  sleep 2
}

publish() { # $1 = h264 | vp8
  local keys patterns i
  keys=$(node -e "console.log(require('$WORK/data/config.json').streams.map(s=>s.key).join(' '))")
  if [ "$1" = vp8 ]; then
    # Smaller and slower-framed: libvpx is expensive, and these have to share
    # the machine with the 1080p programme encode.
    patterns=("testsrc2=size=960x540:rate=10" "smptehdbars=size=960x540:rate=10"
              "mandelbrot=size=960x540:rate=10" "gradients=size=960x540:rate=10:n=4")
  else
    patterns=("testsrc2=size=1280x720:rate=30" "smptehdbars=size=1280x720:rate=30"
              "mandelbrot=size=1280x720:rate=30" "gradients=size=1280x720:rate=30:n=4")
  fi
  i=0
  for k in $keys; do
    if [ "$1" = vp8 ]; then
      ffmpeg -nostdin -re -f lavfi -i "${patterns[$i]}" \
        -f lavfi -i "sine=frequency=$((220 + i * 110)):sample_rate=48000" \
        -c:v libvpx -deadline realtime -cpu-used 16 -pix_fmt yuv420p -g 20 -b:v 900k \
        -error-resilient 1 -auto-alt-ref 0 -threads 1 \
        -c:a libopus -b:a 48k -ar 48000 -ac 2 \
        -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:$RTSP_PORT/live/$k" \
        > "$WORK/pub_$i.log" 2>&1 &
    else
      ffmpeg -nostdin -re -f lavfi -i "${patterns[$i]}" \
        -f lavfi -i "sine=frequency=$((220 + i * 110)):sample_rate=48000" \
        -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 60 -b:v 2500k \
        -c:a aac -b:a 128k -ar 48000 -ac 2 \
        -f flv "rtmp://127.0.0.1:$RTMP_PORT/live/$k" \
        > "$WORK/pub_$i.log" 2>&1 &
    fi
    PUB_PIDS+=($!)
    PIDS+=($!)
    i=$((i + 1))
  done
}

on_air() {
  curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q '"onAir":4'
}

# The encoder is spawned only after the sources settle, and on a small machine
# it can take a while to produce its first frame. Both passes want a programme
# that is genuinely live, not one that is still starting.
programme_live() {
  curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q '"encoding":true' &&
    curl -fsS "http://127.0.0.1:$API_PORT/v3/paths/get/program" 2>/dev/null | grep -q '"ready":true'
}

# ------------------------------------------------------------------ admin pass
#
# Nothing on these screens has to decode in the browser, so they run against the
# real H.264 encoder: the load, bitrate and restart figures are the honest ones.

echo "==> admin screens (real H.264 encoder)"
# The stand-in platform for the seeded restream destination. `-listen 1` serves
# exactly one connection, which is all this needs: the relay connects once the
# source starts publishing and stays for the whole admin pass.
ffmpeg -y -nostdin -hide_banner -loglevel error -listen 1 \
  -f flv -i "rtmp://127.0.0.1:$SINK_PORT/live/demo" -c copy -f null - > "$WORK/sink.log" 2>&1 &
PIDS+=($!)
start_server "$(command -v ffmpeg)"
wait_for "the server" "curl -fsS http://127.0.0.1:$PORT/healthz"
publish h264
wait_for "four sources on air" on_air
wait_for "the programme" programme_live
# Let the encoder reach a steady state so the Server tab is not a cold start.
sleep 45
node "$ROOT/scripts/screenshots.mjs" --base "http://127.0.0.1:$PORT" --out "$WORK/out" \
  --password "$PASSWORD" --pass admin

# ----------------------------------------------------------------- viewer pass

echo "==> viewer screens (VP8 so the capture browser can decode)"
stop_publishers
stop_server
sleep 2
start_server "$WORK/ffmpeg-vp8"
wait_for "the server" "curl -fsS http://127.0.0.1:$PORT/healthz"
publish vp8
wait_for "four sources on air" on_air
wait_for "the programme" programme_live
node "$ROOT/scripts/screenshots.mjs" --base "http://127.0.0.1:$PORT" --out "$WORK/out" \
  --password "$PASSWORD" --pass viewer

# ------------------------------------------------------------------ post-process

echo "==> writing $OUT"
if python3 -c 'import PIL' 2>/dev/null; then
  python3 "$ROOT/scripts/screenshots-optimise.py" "$WORK/out" "$OUT"
else
  echo "    (python3 + Pillow not found — copying full-size captures)"
  cp "$WORK"/out/*.png "$OUT/"
fi

ls -la "$OUT"/*.png
