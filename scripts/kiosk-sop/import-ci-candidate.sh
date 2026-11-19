#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo 'Usage: pnpm kiosk-sop:from-ci <run-id>' >&2
  exit 2
fi

run_id="$1"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! node scripts/kiosk-sop/source-digest.mjs check; then
  echo 'Run pnpm kiosk-sop:source-refresh, commit and push, then import after the CI kiosk-sop job creates a candidate. If CI still fails its digest check, merge main and retry.' >&2
  exit 1
fi

head_sha="$(git rev-parse HEAD)"
run_sha="$(gh run view "$run_id" --json headSha --jq '.headSha')"
if [[ "$run_sha" != "$head_sha" ]]; then
  echo "Run $run_id head: $run_sha. Local HEAD: $head_sha." >&2
  exit 1
fi

artifact_name="$(
  gh api --paginate "repos/{owner}/{repo}/actions/runs/$run_id/artifacts" \
    --jq '.artifacts[] | select(.expired == false and (.name | startswith("kiosk-sop-diagnostics-"))) | .name' |
    awk -F- '$NF ~ /^[0-9]+$/ && (!found || $NF + 0 > highest) {
      found = 1
      highest = $NF + 0
      name = $0
    } END { if (found) print name }'
)"
if [[ -z "$artifact_name" ]]; then
  echo "Run $run_id has no kiosk-sop candidate. The job may not have run or the artifact expired after 7 days." >&2
  exit 1
fi

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiosk-sop-ci.XXXXXX")"
trap 'rm -rf -- "$download_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
gh run download "$run_id" -n "$artifact_name" -D "$download_dir"

candidate_dir="$download_dir/candidate"
node --input-type=module - "$candidate_dir" <<'NODE'
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateArtifactTree } from './scripts/ci/kiosk-sop-artifact-contract.mjs';
import { manualSources } from './scripts/kiosk-sop/source-digest.mjs';

const candidateRoot = process.argv[2];
if (!(await lstat(candidateRoot)).isDirectory()) throw new Error('Missing candidate directory');
for (const entry of await readdir(candidateRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !Object.hasOwn(manualSources, entry.name)) {
    throw new Error(`Unexpected kiosk SOP candidate entry: ${entry.name}`);
  }
}

for (const [manualId, { committedRoot }] of Object.entries(manualSources)) {
  const manualRoot = join(candidateRoot, manualId);
  for (const dir of ['screens', 'sheets']) {
    const path = join(manualRoot, dir);
    if (!(await lstat(path)).isDirectory()) throw new Error(`Expected a directory: ${path}`);
  }
  for (const file of ['manifest.json', 'manual.html']) {
    const path = join(manualRoot, file);
    if (!(await lstat(path)).isFile()) throw new Error(`Expected a file: ${path}`);
  }
  const { manifest } = await validateArtifactTree(manualRoot);
  const committed = JSON.parse(await readFile(join(committedRoot, 'manifest.json'), 'utf8'));
  if (manifest.sourceSha256 !== committed.sourceSha256) {
    throw new Error(`Candidate source digest differs from the current digest: ${manualId}. main may have changed watched sources: merge main, push, and import from the new run.`);
  }
}
NODE

bash scripts/kiosk-sop/install-generated.sh "$candidate_dir"
if ! node scripts/kiosk-sop/source-digest.mjs check; then
  echo 'Imported, but the digest is stale. main may have changed watched sources: merge main, push, and import from the new run.' >&2
  exit 1
fi
git status --short
echo 'Review and commit the imported kiosk SOP files.'
