#!/usr/bin/env bash
# Keep this Bash-native script LF-only; enforced by .gitattributes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANCHOR_LIST_FILE="${ROOT_DIR}/tools/ci/invariant-anchor-files.txt"

if [[ "${DOCS_GUARD_OVERRIDE:-0}" == "1" ]]; then
  echo "[docs-anchor-guard] DOCS_GUARD_OVERRIDE=1, guard bypassed."
  exit 0
fi

if [[ ! -f "${ANCHOR_LIST_FILE}" ]]; then
  echo "[docs-anchor-guard] Missing anchor list: ${ANCHOR_LIST_FILE}" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[docs-anchor-guard] git is unavailable; best-effort pass." >&2
  echo "[docs-anchor-guard] In CI, run with full git metadata and set DOCS_GUARD_BASE to the target branch commit/ref." >&2
  exit 0
fi

if ! git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[docs-anchor-guard] Not a git worktree; best-effort pass." >&2
  echo "[docs-anchor-guard] In CI, execute inside a git checkout with history available." >&2
  exit 0
fi

if ! git -C "${ROOT_DIR}" rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "[docs-anchor-guard] HEAD is unavailable; best-effort pass." >&2
  echo "[docs-anchor-guard] In CI, ensure repository history is fetched before running guard." >&2
  exit 0
fi

DIFF_RANGE=""
if [[ -n "${DOCS_GUARD_BASE:-}" ]] && git -C "${ROOT_DIR}" rev-parse --verify "${DOCS_GUARD_BASE}^{commit}" >/dev/null 2>&1; then
  DIFF_RANGE="${DOCS_GUARD_BASE}...HEAD"
elif git -C "${ROOT_DIR}" rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  DIFF_RANGE="HEAD~1...HEAD"
fi

declare -a changed_files=()
if [[ -n "${DIFF_RANGE}" ]]; then
  mapfile -t changed_files < <(git -C "${ROOT_DIR}" diff --name-only --diff-filter=ACMR "${DIFF_RANGE}")
else
  mapfile -t changed_files < <(git -C "${ROOT_DIR}" diff --name-only --diff-filter=ACMR HEAD)
fi

if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "[docs-anchor-guard] No changed files detected."
  exit 0
fi

declare -A changed_lookup=()
for file in "${changed_files[@]}"; do
  if [[ -n "${file}" ]]; then
    changed_lookup["${file}"]=1
  fi
done

declare -a touched_anchor_files=()
while IFS= read -r anchor || [[ -n "${anchor}" ]]; do
  if [[ -z "${anchor}" ]] || [[ "${anchor}" == \#* ]]; then
    continue
  fi

  if [[ -n "${changed_lookup["${anchor}"]:-}" ]]; then
    touched_anchor_files+=("${anchor}")
  fi
done < "${ANCHOR_LIST_FILE}"

if [[ "${#touched_anchor_files[@]}" -eq 0 ]]; then
  echo "[docs-anchor-guard] No invariant-anchor files changed."
  exit 0
fi

authority_docs_changed=0
for file in "${changed_files[@]}"; do
  if [[ "${file}" == docs/architecture/* ]] || [[ "${file}" == docs/contracts/* ]] || [[ "${file}" == docs/execution/* ]] || [[ "${file}" == docs/invariant-registry.md ]]; then
    authority_docs_changed=1
    break
  fi
done

if [[ "${authority_docs_changed}" -eq 1 ]]; then
  echo "[docs-anchor-guard] Anchor files changed and authority-tier docs also changed."
  exit 0
fi

echo "[docs-anchor-guard] FAIL: invariant-anchor files changed without authority-tier docs updates." >&2
echo "[docs-anchor-guard] Touched anchor files:" >&2
for file in "${touched_anchor_files[@]}"; do
  echo " - ${file}" >&2
done
echo "[docs-anchor-guard] Required docs tiers: docs/architecture/*, docs/invariant-registry.md, docs/contracts/*, docs/execution/*" >&2
echo "[docs-anchor-guard] Use DOCS_GUARD_OVERRIDE=1 to bypass intentionally." >&2
exit 1
