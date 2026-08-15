# Performance and CPU sizing

Stream Composer is built for machines without a GPU. This page explains what the
work actually costs, how to size a server, and which knobs are worth turning.

Everything here is measured, not estimated from first principles — and you can
reproduce it on your own hardware in a couple of minutes with
`./scripts/benchmark.sh`.

---

## Where the time goes

Composing a grid is three jobs per second of output:

1. **Decode** every incoming stream (N × 720p30 H.264).
2. **Scale and place** each one into its cell, then composite onto the canvas.
3. **Encode** the canvas once (1080p30 H.264).

The encode is a fixed cost — one 1080p30 stream, no matter how many sources.
Decode and scale grow linearly with the number of sources. That gives a cost
model of the form `base + per_source × N`, which is exactly what the benchmark
fits.

## Measured cost model

On a 2-core Intel Xeon at 2.1 GHz, 720p30 inputs into 1080p30 output,
libx264 `ultrafast` `zerolatency`:

| Sources | Grid | Speed vs real time | CPU per second of output |
|--------:|:----:|-------------------:|-------------------------:|
| 1  | 1×1 | 3.9× | 0.34 cores |
| 4  | 2×2 | 2.0× | 0.66 cores |
| 9  | 3×3 | 1.0× | 1.29 cores |
| 16 | 4×4 | 0.6× | 1.98 cores |

Fitting those:

```
core-seconds per second of output  ≈  0.24  +  0.111 × sources
```

Read it as: **the encoder plus canvas costs about a quarter of a core, and every
additional source adds roughly 11% of a core** to decode and scale — on a 2.1 GHz
core. A modern 3.5 GHz core does noticeably more per second, so treat this as the
conservative floor.

Anything at or above 1.0× keeps up with live. Below that, frames are dropped and
the output stutters.

## Sizing table

Derived from the model above with headroom for ingest, packaging, viewer traffic
and the inevitable reconnect. Inputs 720p30, output as stated, preset
`ultrafast`.

### 1080p30 output

| Sources | Cores at 2.1 GHz | Cores at 3.5 GHz | Comfortable server |
|--------:|-----------------:|-----------------:|:-------------------|
| 1–2   | 1 | 1 | 1 vCPU, 1 GB |
| 3–4   | 2 | 1–2 | 2 vCPU, 2 GB |
| 5–8   | 2–3 | 2 | 4 vCPU, 2 GB |
| 9–12  | 3–4 | 2–3 | 4 vCPU, 4 GB |
| 13–16 | 4–5 | 3 | 6–8 vCPU, 4 GB |
| 17–25 | 6–8 | 4–5 | 8 vCPU, 8 GB |

### 720p30 output

Roughly 55% of the 1080p cost, because the encode and every scale operation
handle fewer than half the pixels. A 4 vCPU box comfortably handles 16 sources.

### 1080p60 output

Double the frame rate, double the work — and the encoder cost roughly doubles
too. Halve every source count in the 1080p30 table.

> **Memory** is not the constraint: the service itself sits around 60–90 MB, and
> ffmpeg uses roughly 40–60 MB per source. 2 GB is plenty up to about 12 sources.

## The bottleneck is clock speed, not core count

A measured surprise worth knowing about: on the test machine the pipeline never
used more than about 1.3 cores, whatever the source count — and adding
`-filter_threads` / `-filter_complex_threads` changed nothing.

The filter graph — the scale and overlay chain — runs largely in a single
thread. x264 parallelises across frames, but the compositing ahead of it does
not. So:

- **Fast cores beat many cores.** A 4-core machine at 3.6 GHz will out-compose an
  8-core machine at 2.2 GHz for this workload.
- Beyond roughly 8 cores, extra cores mostly buy you headroom for other work
  (ingest, HLS packaging, viewers), not more sources.
- If you need many more sources than one machine can manage, run a second
  instance rather than buying more cores.

## Tuning, in order of effect

**1. Output resolution.** The single biggest lever. Dropping 1080p → 720p cuts
the total cost by about 45%. If the grid is watched in a browser window rather
than on a video wall, 720p is usually indistinguishable.

**2. Frame rate.** 30 → 25 fps saves about 17% for free. 30 → 15 fps halves the
cost and is fine for monitoring.

**3. x264 preset.** `ultrafast` is the default and the right choice for live.
Each step slower costs roughly 30–60% more CPU for quality you will not notice at
a sensible bitrate:

| Preset | Relative CPU | When to use it |
|---|---:|---|
| `ultrafast` | 1.0× | Default. Lowest latency, highest bitrate for a given quality. |
| `superfast` | 1.3× | Slightly better quality if you have spare CPU. |
| `veryfast` | 1.7× | Only if bandwidth costs more than CPU. |
| `faster`+ | 2.5×+ | Not appropriate for live compositing. |

**4. Scaler.** `bilinear` (the default) against `bicubic` is worth about 10–15%
of the scaling cost at these sizes, and the difference is invisible once the
image is in a small cell. `fast_bilinear` shaves a little more for large grids.
`lanczos` is sharp and expensive — reserve it for one- or two-source layouts.

**5. Source resolution.** Ask publishers for 720p rather than 1080p. Sending
1080p only to scale it into a 640×360 cell wastes decode time on every frame. In
a 3×3 grid at 1080p output, each cell is 634×354 — a 720p source is already more
than enough.

**6. Cell labels.** `drawtext` costs 1–2% per source. Leave them on unless you are
right at the limit.

## Hardware acceleration

Detected automatically; the admin console shows what is usable on this machine
and greys out the rest with the reason.

| Encoder | Requirement | Effect |
|---|---|---|
| **VA-API** | Intel or AMD GPU, `/dev/dri` passed into the container | Removes the encode cost (~0.24 cores); scaling stays on the CPU |
| **NVENC** | NVIDIA GPU with the container toolkit | Same, plus more headroom for high resolutions |
| **Quick Sync** | Intel iGPU with `/dev/dri` | Same as VA-API |

To enable VA-API, uncomment the `devices` block for the `composer` service in
`docker-compose.yml`:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

then set **Encoder** to *Automatic* or *VA-API* in the admin console.

Worth being clear about the size of the prize: hardware encoding removes the
fixed encode cost, not the per-source decode and scale. At 16 sources that is
about 12% of the total. It matters most at high output resolutions and frame
rates, least on large grids of small cells.

## Measuring your own machine

```bash
./scripts/benchmark.sh                       # the default sweep
./scripts/benchmark.sh --counts 6,9,12 --duration 30
./scripts/benchmark.sh --width 1280 --height 720
./scripts/benchmark.sh --preset veryfast
```

It encodes a real H.264 clip — not a synthetic filter source, which would flatter
the result by skipping decode entirely — and reports speed, CPU time, load and a
fitted cost model for your hardware.

If the machine is a container with a CPU quota below its visible core count, the
benchmark detects and reports that, so the verdict does not look mysteriously
pessimistic.

## Watching it in production

The admin console's **Server** tab shows live CPU, memory, encoder frame rate,
output bitrate and restart count. Two things to watch:

- **Encoder speed below 1.0×** — the machine is not keeping up. Reduce the output
  resolution or frame rate first.
- **Rising restart count** — sources are flapping, not a CPU problem. Look at the
  network between the publishers and the server, and consider raising the settle
  delay in Settings so brief dropouts do not trigger a rebuild.
