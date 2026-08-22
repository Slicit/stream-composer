# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /dataplane ./cmd/dataplane

FROM gcr.io/distroless/static-debian12
COPY --from=build /dataplane /dataplane
EXPOSE 8080
ENTRYPOINT ["/dataplane"]
