# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 go build -o /dataplane ./cmd/dataplane

FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --shell /bin/false dataplane \
	&& mkdir -p /data && chown dataplane:dataplane /data
COPY --from=build /dataplane /dataplane
USER dataplane
# DATA_DIR (bandwidthhistory.Tracker's persisted history) — mount a named
# volume here in production so a redeploy doesn't lose the trend; the dev
# migration stack instead bind-mounts a read-only directory and simply
# accepts that the tracker can't persist there (see its own warning log).
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/dataplane"]
