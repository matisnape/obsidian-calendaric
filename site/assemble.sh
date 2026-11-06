#!/usr/bin/env bash
# Copies the guides from docs/ (their single source) into site/guides/ so Jekyll
# renders them. Run from the repo root; the workflow runs it before the build.
# Each copy gets front matter, and its body is wrapped in {% raw %} because the
# guides show template tokens like {{date}} that Liquid would try to expand.
# The testing guide moves from docs/qa/ to the same folder as the others, so its
# ../guide.md links become guide.md.
set -euo pipefail

copy() { # <source> <title>
  local out="site/guides/$(basename "$1")"
  {
    printf -- '---\ntitle: %s\n---\n{%% raw %%}\n' "$2"
    sed 's#(\.\./guide\.md#(guide.md#g' "$1"
    printf '\n{%% endraw %%}\n'
  } > "$out"
}

copy docs/user-manual.md "User manual"
copy docs/guide.md "Format and template guide"
copy docs/code-map.md "Code map"
copy docs/qa/testing-guide.md "Manual testing guide"
