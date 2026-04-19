.PHONY: help install test test-watch typecheck publish-jsr publish-jsr-dry clean

help:
	@echo "Available targets:"
	@echo "  install         Install dependencies (pnpm)"
	@echo "  test            Run tests once (vitest)"
	@echo "  test-watch      Run tests in watch mode"
	@echo "  typecheck       Type-check without emitting"
	@echo "  publish-jsr-dry Dry-run JSR publish"
	@echo "  publish-jsr     Publish to JSR"
	@echo "  clean           Remove node_modules"

install:
	pnpm install

test:
	pnpm test

test-watch:
	pnpm test:watch

typecheck:
	pnpm typecheck

publish-jsr-dry:
	pnpm publish:jsr:dry

publish-jsr:
	pnpm publish:jsr

clean:
	rm -rf node_modules
