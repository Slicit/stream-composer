# Connecting OBS Studio

The goal is two fields and a button. Everything else on this page is optional.

---

## The short version

1. In the admin console, **Streams → Create**, give it a name.
2. Press **OBS** next to the new stream. You get the server URL and the key.

![The Streams tab, where each row has an OBS button that reveals the server URL and key](screenshots/admin-streams.png)

3. In OBS: **Settings → Stream**
   - **Service:** `Custom...`
   - **Server:** `rtmp://your-server/live`
   - **Stream Key:** the key from step 2
4. **Start Streaming.**

The stream appears in the grid within a couple of seconds. Stop streaming and the
grid re-lays itself without it.

## Output settings that work well

**Settings → Output → Output Mode: Advanced → Streaming**

| Setting | Value | Why |
|---|---|---|
| Encoder | x264 (or hardware, if the publishing machine has it) | |
| Rate Control | CBR | Predictable bandwidth; the composer scales it anyway |
| Bitrate | 2500–4000 kb/s | Ample for 720p30 into a grid cell |
| Keyframe Interval | 2 s | Faster recovery and cleaner joins |
| CPU Usage Preset | `veryfast` | Good balance on the publishing machine |
| Profile | `high` | |
| Tune | `zerolatency` | Removes frame reordering delay |

**Settings → Video**

| Setting | Value |
|---|---|
| Output (Scaled) Resolution | 1280×720 |
| Common FPS Values | 30 |

Sending 1080p is usually wasted: in a 3×3 grid on a 1080p canvas each cell is
634×354, so a 720p source already carries more detail than the cell can show, and
the server pays to decode every one of those extra pixels. See
[PERFORMANCE.md](PERFORMANCE.md).

## The helper script

[`obs/stream-composer.lua`](../obs/stream-composer.lua) fills in the streaming
service for you, so nobody has to find the right settings page.

1. Save the file somewhere permanent.
2. **Tools → Scripts → +** and select it.
3. Paste the server URL and stream key, then press **Apply to OBS**.

You can also paste the whole `rtmp://host/live/your-key` into the server field —
the key is picked out of it automatically.

There is a **Start streaming as soon as OBS opens** option for unattended
machines: OBS launches, configures itself and goes live without anyone touching
it.

The script only sets the server and key. Your encoder, resolution and bitrate
settings are left alone.

## Several OBS instances on one machine

Each instance needs its own profile and its own stream key:

```bash
obs --profile "Camera 1" --multi
obs --profile "Camera 2" --multi
```

Create a separate stream in the admin console for each, and give each profile its
own key. `--multi` suppresses the "OBS is already running" warning.

## Encrypted ingest (RTMPS)

If you installed with a domain, TLS-wrapped RTMP is available on port 1936 using
the same certificate as the web interface:

- **Server:** `rtmps://your-domain:1936/live`
- **Stream Key:** unchanged

Use it whenever the network between the publisher and the server is not trusted.
The admin console shows the RTMPS URL alongside the plain one when it is enabled.

## SRT

For lossy links — mobile, satellite, long-haul — SRT recovers from packet loss far
better than RTMP:

- **Service:** `Custom...`
- **Server:** `srt://your-server:8890?streamid=publish:live/your-key`
- **Stream Key:** leave empty

The exact URL is shown in the OBS dialog for each stream.

## Other publishers

Nothing here is OBS-specific. Anything that speaks RTMP or SRT works — hardware
encoders, `ffmpeg`, drones, phone apps:

```bash
ffmpeg -re -i input.mp4 -c:v libx264 -preset veryfast -tune zerolatency \
       -b:v 3000k -g 60 -c:a aac -b:a 128k \
       -f flv rtmp://your-server/live/your-key
```

That is also the quickest way to test a fresh install without setting up a camera.

## Common problems

**"Failed to connect to server"** — the RTMP port is not reachable. Check the
firewall allows inbound 1935/tcp, and that the server URL ends in `/live` with no
trailing slash.

**Connects, then immediately drops** — the key is wrong, or the stream is
disabled. The server logs the reason: **Admin → Logs**, look for `denied`.

**Publishing but not in the grid** — give it two seconds; the composer waits for
the source set to settle before rebuilding. If it still does not appear, check
the stream is enabled and, if the composition is set to *manual* source
selection, that the key is in the order list.

More in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
