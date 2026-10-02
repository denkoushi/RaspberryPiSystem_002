# KB-414: Pi4 agent image builds took about one hour on linux/arm/v7

- Status: `active`
- Scope: CI jobs `pi4-agent-image-contract` and `pi4-agent-images-publish`; `infrastructure/docker/Dockerfile.{nfc,barcode,torque}-agent`

## Context

On 2026-10-02 the linux/arm/v7 builds of the three Pi4 agent images took 35-56 minutes in the #1623 PR run (36942790087), again in the `main` push run for `d3eadd94`, and again in the #1625 PR run. The `main` CI runs one at a time, so approved PRs could not be released for about an hour. The night before, the same publish jobs finished in about 1.5 minutes.

## Symptoms Or Trigger

- Step `Build the Pi4 agent image contract` (PR) and `Publish the exact-SHA multi-platform Pi4 agent image` (`main`) ran for 35-56 minutes on linux/arm/v7. linux/arm64 took 7-8 minutes.
- No layer was reported `CACHED`.

## Investigation

- Hypothesis: the `pnpm-lock.yaml` change invalidated the agent build cache. Result: rejected. `pnpm-lock.yaml` is in `PI4_AGENT_NON_BUILD_GLOBAL_PATHS` and selects no agent. The agents were selected by `scripts/ci/tests/test_pi5_container_runtime_boundaries.py`, a global CI path.
- Hypothesis: the build context or `COPY` range is too wide. Result: rejected. The Dockerfiles copy only `clients/<agent>`.
- Evidence for the cache miss: the base image `python:3.11-slim` resolved to `sha256:e41613d4...` in the previous `main` run (every layer `CACHED`) and to `sha256:9f6ef439...` in run 36942790087 (no layer `CACHED`). The upstream tag was republished.
- Evidence for the duration (linux/arm/v7, run 36942790087):

| Agent | `pip install poetry` | `poetry install` | Job |
| --- | --- | --- | --- |
| nfc-agent | 37 min | 15 min | 56 min |
| torque-agent | 34 min | 14 min | 52 min |
| barcode-agent | 23 min | 10 min | 35 min |

- `pip install poetry` was unpinned and compiled Poetry's own dependencies (`backports.zstd`, `msgpack`, `cffi`, ...) from source under QEMU, because they publish no linux/arm/v7 wheel.
- GitHub Actions caches are scoped by ref. `main` cannot read a cache written by a PR, so the PR, the `main` push and every other open PR each paid the full rebuild.

## Root Cause

A republished base image invalidates every layer (intended: this is how OS security updates arrive). The rebuild was slow because Poetry itself was installed inside the emulated target platform.

## Fix

Poetry now runs in a `lock-export` stage pinned to `--platform=$BUILDPLATFORM` (`poetry==2.4.1`, `poetry-plugin-export==1.10.1`). It exports `requirements.txt` with hashes from `poetry.lock`; the torque wheel (pure Python) is built there too. The target-platform builder runs only `pip install --require-hashes -r requirements.txt`.

Unchanged on purpose:

- The base image stays a floating tag, so an upstream refresh still rebuilds every layer, including the runtime `apt-get` upgrade.
- The runtime-stage package floors (OpenSSL, util-linux, ...) and the Trivy scans are untouched.

## Prevention

- Do not install build tooling inside the target platform of an emulated build. Resolve on `$BUILDPLATFORM`, install on the target.
- Pin the tooling version; an unpinned `pip install poetry` changes what is compiled without any repository change.

## Validation

- Local linux/arm64 build of all three Dockerfiles. nfc-agent installs the same 25 distributions at the same versions as the previous `poetry install`; no `poetry` or `pip` remains in the image.
- CI timings for linux/arm/v7 are recorded in the PR that introduced this change.

## Open Items

- A rebuild is still paid once per ref (PR, then `main`). A scheduled cache warm-up on `main` would move base-image refreshes off the merge path.
- `poetry install` (now `pip install`) of the agent's own dependencies still compiles some packages under QEMU.
- Actions cache usage was 10.8 GB against the 10 GB limit on 2026-10-02, so older caches are evicted early.

## References

- Runs: 36942790087 (#1623 PR), 36947829221 (`main` `d3eadd94`), 36841750531 (`main` `706d7b06`, cached)
- `.github/workflows/ci.yml` jobs `pi4-agent-image-contract`, `pi4-agent-images-publish`
- `scripts/ci/classify_changes.py` (`PI4_AGENT_NON_BUILD_GLOBAL_PATHS`)
