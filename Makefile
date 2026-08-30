# token-engine — install and run.
#
# There is nothing to compile and nothing to download: `make install` only
# checks that Node is present. `make run` serves the engine in the foreground;
# `make start` / `make stop` run it in the background.
#
# Overrides:
#   make run PORT=5000
#   CLAUDE_PROJECTS=/custom/path make run   # inherited from the environment

PORT ?= 4321
NODE ?= node

URL := http://localhost:$(PORT)
PID := .token-engine.pid
LOG := .token-engine.log

OPENER := $(shell command -v open >/dev/null 2>&1 && echo open || echo xdg-open)

.DEFAULT_GOAL := help
.PHONY: help check-node install run start stop restart status logs browse bench clean

help:
	@echo "token-engine"
	@echo
	@echo "  make install   check prerequisites (Node 12+); nothing is downloaded"
	@echo "  make run       run the server in the foreground on $(URL)"
	@echo "  make start     run it in the background, logging to $(LOG)"
	@echo "  make stop      stop the background server"
	@echo "  make restart   stop, then start"
	@echo "  make status    is the background server up?"
	@echo "  make logs      tail $(LOG)"
	@echo "  make browse    open $(URL) in a browser"
	@echo "  make bench     open test.html — the audio bench, no server needed"
	@echo "  make clean     remove $(PID) and $(LOG)"
	@echo
	@echo "  PORT=$(PORT)   override with 'make run PORT=5000'"

check-node:
	@command -v $(NODE) >/dev/null 2>&1 || { \
	    echo "error: '$(NODE)' not found. Install Node 12 or newer."; exit 1; }

install: check-node
	@echo "node $$($(NODE) --version) found — no dependencies to install. Next: make run"

run: check-node
	PORT=$(PORT) $(NODE) server.js

start: check-node
	@if [ -f $(PID) ] && kill -0 "$$(cat $(PID))" 2>/dev/null; then \
	    echo "already running (pid $$(cat $(PID))) -> $(URL)"; exit 0; \
	fi
	@PORT=$(PORT) nohup $(NODE) server.js > $(LOG) 2>&1 & echo $$! > $(PID)
	@echo "started (pid $$(cat $(PID))) -> $(URL)"
	@echo "logs: make logs    stop: make stop"

stop:
	@if [ -f $(PID) ] && kill -0 "$$(cat $(PID))" 2>/dev/null; then \
	    kill "$$(cat $(PID))" && echo "stopped (pid $$(cat $(PID)))"; \
	else \
	    echo "not running"; \
	fi
	@rm -f $(PID)

restart:
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

status:
	@if [ -f $(PID) ] && kill -0 "$$(cat $(PID))" 2>/dev/null; then \
	    echo "running (pid $$(cat $(PID))) -> $(URL)"; \
	else \
	    echo "not running"; \
	fi

logs:
	@tail -f $(LOG)

browse:
	@$(OPENER) $(URL)

bench:
	@$(OPENER) test.html

clean:
	rm -f $(PID) $(LOG)
