#!/bin/sh
# Report corral installs as GitHub Release asset downloads.
set -eu

REPO="${CORRAL_REPO:-alok-mishra143/Corral}"
MODE="table"
LATEST=""

usage() {
  cat <<'EOF'
Report corral installs as GitHub Release asset downloads.

usage: sh scripts/installs.sh [--json | --total] [--latest]

  --latest   query only the latest release
  --total    print only the grand total (a number)
  --json     print machine-readable JSON

env:
  CORRAL_REPO   owner/name to query (default: alok-mishra143/Corral)
  GITHUB_TOKEN  token used by the curl fallback when `gh` is unavailable
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --json) MODE="json" ;;
    --total) MODE="total" ;;
    --latest) LATEST="1" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "installs: unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

JQ='
  .[] | .tag_name as $t | .assets[] |
  [$t, .name, (.download_count | tostring)] | @tsv
'

JQ_LATEST='
  .tag_name as $t | .assets[] |
  [$t, .name, (.download_count | tostring)] | @tsv
'

fetch_url() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$1"
  else
    curl -fsSL "$1"
  fi
}

fetch_tsv() {
  if command -v gh >/dev/null 2>&1; then
    if [ -n "$LATEST" ]; then
      gh api "repos/$REPO/releases/latest" --jq "$JQ_LATEST"
    else
      gh api "repos/$REPO/releases?per_page=100" --paginate --jq "$JQ"
    fi
    return
  fi
  command -v curl >/dev/null 2>&1 || { echo "installs: need gh or curl" >&2; exit 1; }
  command -v jq >/dev/null 2>&1 || { echo "installs: curl fallback needs jq" >&2; exit 1; }
  if [ -n "$LATEST" ]; then
    fetch_url "https://api.github.com/repos/$REPO/releases/latest" | jq -r "$JQ_LATEST"
    return
  fi
  page=1
  while :; do
    body="$(fetch_url "https://api.github.com/repos/$REPO/releases?per_page=100&page=$page")" || return 1
    printf '%s' "$body" | jq -r "$JQ"
    [ "$(printf '%s' "$body" | jq 'length')" -lt 100 ] && break
    page=$((page + 1))
  done
}

if ! TSV="$(fetch_tsv)"; then
  echo "installs: could not query $REPO (run 'gh auth login', or set GITHUB_TOKEN)" >&2
  exit 1
fi

if [ "$MODE" = "total" ]; then
  printf '%s\n' "$TSV" | awk -F '\t' '{ n += $3 } END { printf "%d\n", n }'
  exit 0
fi

if [ -z "$TSV" ] && [ "$MODE" = "table" ]; then
  printf 'downloads for %s\n\nno releases found\n' "$REPO"
  exit 0
fi

if [ "$MODE" = "json" ]; then
  printf '%s\n' "$TSV" | awk -F '\t' -v repo="$REPO" '
    function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
    {
      if (!($1 in rid)) { rid[$1] = ++n; tag[n] = $1 }
      r = rid[$1]
      i = ++idx[r]
      an[r, i] = $2
      av[r, i] = $3
      rt[r] += $3
      total += $3
    }
    END {
      printf "{\"repo\":\"%s\",\"total\":%d,\"releases\":[", esc(repo), total
      for (r = 1; r <= n; r++) {
        if (r > 1) printf ","
        printf "{\"tag\":\"%s\",\"total\":%d,\"assets\":[", esc(tag[r]), rt[r]
        for (i = 1; i <= idx[r]; i++) {
          if (i > 1) printf ","
          printf "{\"name\":\"%s\",\"downloads\":%d}", esc(an[r, i]), av[r, i]
        }
        printf "]}"
      }
      printf "]}\n"
    }'
  exit 0
fi

printf '%s\n' "$TSV" | awk -F '\t' -v repo="$REPO" '
  {
    rows[NR] = $0
    n1 = split($0, f, "\t")
    if (length(f[1]) > w1) w1 = length(f[1])
    if (length(f[2]) > w2) w2 = length(f[2])
    total += f[3]
    rel[f[1]] += f[3]
    if (!(f[1] in rc)) { rc[f[1]] = ++r; order[r] = f[1] }
  }
  BEGIN { w1 = 7; w2 = 5 }
  END {
    printf "downloads for %s\n\n", repo
    printf "%-*s  %-*s  %10s\n", w1, "RELEASE", w2, "ASSET", "DOWNLOADS"
    for (i = 1; i <= NR; i++) {
      split(rows[i], f, "\t")
      printf "%-*s  %-*s  %10d\n", w1, f[1], w2, f[2], f[3]
    }
    printf "\n"
    if (r > 1) {
      for (i = 1; i <= r; i++)
        printf "%-*s  %-*s  %10d\n", w1, order[i], w2, "release total", rel[order[i]]
      printf "\n"
    }
    printf "TOTAL downloads: %d\n", total
  }'
