# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /dataplane ./cmd/dataplane

FROM debian:12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /dataplane /dataplane
EXPOSE 8080
ENTRYPOINT ["/dataplane"]
