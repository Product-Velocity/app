#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json -> ignoreCommand).
# Exit 0 = skip this build, exit 1 = build. Any doubt or error builds.
# Skips only when every changed file is outside the app: prototype boards, specs,
# decisions, skills, spikes, GitHub workflows/templates and root Markdown files.
# docs/RELEASES.md is read by next.config.mjs, so it always builds.
set -u

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  base="HEAD^"
fi

changed="$(git diff --name-only "$base" HEAD 2>/dev/null)" || exit 1
[ -n "$changed" ] || exit 1

while IFS= read -r f; do
  case "$f" in
    docs/RELEASES.md) exit 1 ;;
    docs/*|prototype/*|spikes/*|skills/*|.github/*) ;;
    *.md) case "$f" in */*) exit 1 ;; esac ;;
    *) exit 1 ;;
  esac
done <<< "$changed"

echo "Only docs/prototype/skills/spikes/.github/root Markdown changed; skipping build."
exit 0
