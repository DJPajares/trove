#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${PWCLI_BIN:-}" ]]; then
  playwright_cli="$PWCLI_BIN"
elif command -v playwright-cli >/dev/null 2>&1; then
  playwright_cli="$(command -v playwright-cli)"
elif cached_playwright_cli="$(find "$HOME/.npm/_npx" -path '*/node_modules/.bin/playwright-cli' -type f -perm -111 -print -quit 2>/dev/null)" && [[ -n "$cached_playwright_cli" ]]; then
  playwright_cli="$cached_playwright_cli"
else
  playwright_cli="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
fi
session="${PLAYWRIGHT_CLI_SESSION:-trove-chrome}"

if [[ ! -x "$playwright_cli" ]]; then
  echo "Playwright CLI wrapper not found: $playwright_cli" >&2
  exit 1
fi

if [[ "${1:-}" == "attach" ]]; then
  shift
  channel="${1:-chrome}"
  if [[ $# -gt 0 ]]; then shift; fi
  exec "$playwright_cli" --session "$session" attach --cdp="$channel" "$@"
fi

if [[ "${1:-}" == "detach" ]]; then
  shift
  exec "$playwright_cli" --session "$session" detach "$@"
fi

if [[ $# -eq 0 ]]; then
  cat >&2 <<'USAGE'
Usage:
  scripts/playwright-current-chrome.sh attach [chrome]
  scripts/playwright-current-chrome.sh goto http://localhost:3000/trips
  scripts/playwright-current-chrome.sh snapshot
  scripts/playwright-current-chrome.sh screenshot --filename=output/playwright/current-chrome.png
  scripts/playwright-current-chrome.sh detach

The attach command connects to the explicitly remote-debugging Chrome session named
"trove-chrome". It leaves Chrome running when you detach.
USAGE
  exit 2
fi

cd "$repo_root"
exec "$playwright_cli" --session "$session" "$@"
