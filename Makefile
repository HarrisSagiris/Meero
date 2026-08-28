# Meero — single-flag environment switch.
#
# Set APP_ENV=local or APP_ENV=prod in ./.env, then just:
#   make build
#   make up
#   make down
#   make logs
#   make ps
#
# APP_ENV=prod automatically:
#   - layers docker-compose.prod.yml on top of docker-compose.yml (bakes
#     NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.meero.im into the Next.js
#     build, and adds --proxy-headers to the api container for a reverse
#     proxy in front of it)
#   - exports BIND_ADDR=127.0.0.1, so web/api/redis's published ports are
#     only reachable from the VPS itself (a real reverse proxy — see
#     deploy/nginx/ — becomes the sole public entry point)
# Nothing else needed here — the orchestrator's own derived URLs come from
# the SEPARATE APP_ENV in apps/orchestrator/.env (see app/config.py) — set both
# together before deploying for real. See deploy/README.md for the rest.

-include .env
APP_ENV ?= local

COMPOSE := docker compose -f docker-compose.yml
ifeq ($(APP_ENV),prod)
COMPOSE := $(COMPOSE) -f docker-compose.prod.yml
export BIND_ADDR := 127.0.0.1
else
export BIND_ADDR := 0.0.0.0
endif

BUILD_ARGS :=
ifeq ($(NO_CACHE),1)
BUILD_ARGS := --no-cache
endif

.PHONY: env build up down restart logs ps

env:
	@echo "APP_ENV=$(APP_ENV)"
	@echo "BIND_ADDR=$(BIND_ADDR)"

build:
	$(COMPOSE) build $(BUILD_ARGS)

up: build
	$(COMPOSE) up -d

# Same as `up` but WITHOUT rebuilding first — for a fast rollback (retag
# :previous back to :latest, then just recreate containers from it; no
# reason to pay for a rebuild when the image already exists locally).
up-nobuild:
	$(COMPOSE) up -d --force-recreate

down:
	$(COMPOSE) down

restart: build
	$(COMPOSE) up -d --force-recreate

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps
