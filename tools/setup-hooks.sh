#!/bin/sh
# One-time: point git at the version-controlled hooks in tools/hooks.
# Run from the repo root:  sh tools/setup-hooks.sh
git config core.hooksPath tools/hooks
chmod +x tools/hooks/* 2>/dev/null || true
echo "Hooks enabled (core.hooksPath = tools/hooks). Pre-commit will run verify-docs + lint-content."
