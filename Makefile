.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE ?= docker compose

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: up
up: ## Start the stack
	$(COMPOSE) up -d --remove-orphans

.PHONY: down
down: ## Stop the stack
	$(COMPOSE) down

.PHONY: restart
restart: ## Restart the composer service
	$(COMPOSE) restart composer

.PHONY: pull
pull: ## Pull the latest images
	$(COMPOSE) pull

.PHONY: upgrade
upgrade: pull up ## Pull and restart

.PHONY: logs
logs: ## Follow all container logs
	$(COMPOSE) logs -f --tail=100

.PHONY: applog
applog: ## Follow the application log inside the volume
	$(COMPOSE) exec composer tail -f /data/logs/server.log

.PHONY: ffmpeglog
ffmpeglog: ## Follow the ffmpeg log
	$(COMPOSE) exec composer tail -f /data/logs/ffmpeg.log

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) ps

.PHONY: build
build: ## Build the composer image from this checkout
	COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml:docker-compose.build.yml $(COMPOSE) build

.PHONY: dev
dev: ## Run the server on the host against a local MediaMTX
	cd server && npm install && \
	  MEDIAMTX_API=http://127.0.0.1:9997 \
	  MEDIAMTX_RTMP=rtmp://127.0.0.1:1935 \
	  MEDIAMTX_WEBRTC=http://127.0.0.1:8889 \
	  MEDIAMTX_HLS=http://127.0.0.1:8888 \
	  DATA_DIR=../.devdata \
	  npm run dev

.PHONY: test
test: ## Run the unit tests
	cd server && npm ci && npm test

.PHONY: compat
compat: ## Regenerate the Compose v1 fallback files
	python3 scripts/make-compat.py

.PHONY: compat-check
compat-check: ## Verify the Compose v1 fallback is current and equivalent
	python3 scripts/make-compat.py --check
	python3 scripts/check-compose-parity.py

.PHONY: bench
bench: ## Measure how many streams this machine can compose
	./scripts/benchmark.sh

.PHONY: config
config: ## Show the resolved compose configuration
	$(COMPOSE) config

.PHONY: backup
backup: ## Write a tarball of the configuration and users
	@mkdir -p backups
	$(COMPOSE) exec -T composer tar -cz -C /data . > backups/stream-composer-$$(date +%Y%m%d-%H%M%S).tar.gz
	@echo "Wrote backups/stream-composer-*.tar.gz"
