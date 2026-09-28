# DGX Spark as the night preparation worker for business Hermes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

Business Hermes Chat on the Pi 5 answers shop-floor questions from records such as nonconformity reports. Two things make those answers good: records that were prepared in advance (an LLM writes a short summary, likely questions, and alternative wordings for each record, called enrichment), and a meaning-based search (each record and each question is turned into a list of numbers, called an embedding, so records with a similar meaning can be found even when the words differ).

Today both run on the DGX Spark (the local AI server), but not in a planned way. On 2026-09-28 almost every Chat question lost its meaning-based search: the DGX embedding service runs on the CPU only and handles two requests at a time, and after about 1,000 records were enriched overnight, the Pi 5 re-embedded them in the morning and filled both slots for many minutes. A question waits up to 800 ms for its embedding and then falls back to word matching, so paraphrased questions got worse exactly after enrichment made them better.

After this plan, the DGX does the heavy work at night and stays fast in the day. At night it enriches changed records, embeds them, and links records across sources (for example a nonconformity to the production schedule row with the same order number). In the day it only embeds the question, on the GPU, in tens of milliseconds. When a new record arrives in an existing source, or a new source is added, the same night flow picks it up without code written for that source. A person can see it working by asking a paraphrased question in the morning after a large overnight run and finding `vectorStatus: ok` in the answer receipt log.

## Progress

- [x] (2026-09-28) Measured the problem. Query embedding from the Pi 5 took 0.89 to 5.2 s (10 calls), and 1.5 to 5.4 s directly on the DGX while the Pi 5 re-embedded changed records. The embedding process used about 16 of 20 CPU cores. Receipts showed 3 of 4 meaning-based questions timed out at 800 ms.
- [x] (2026-09-28) Read the DGX side. The embedding service is CPU-only on purpose (see Context).
- [ ] Owner decisions D1 to D3 in the Decision Log.
- [ ] Milestone 1: day-time protection on the Pi 5.
- [ ] Milestone 2: GPU query embedding on the DGX.
- [ ] Milestone 3: one night flow for every source.
- [ ] Milestone 4: links between sources.
- [ ] Milestone 5: adding a source without new night code.

## Surprises & Discoveries

- Observation: the embedding re-run after enrichment is incremental but large. The Pi 5 keeps a vector file and re-embeds only records whose embedded text changed, but enrichment is part of that text, so every enriched record is re-embedded.
  Evidence: `refreshDenseIndex` in `scripts/hermes-search/retrieval/dense-dgx.mjs` compares a SHA-256 of the document text; the vector file grew about one record per second on 2026-09-28 after about 1,000 records changed.
- Observation: the full-corpus enrichment started 2026-09-28 will change about 7,200 more records, so without a change the morning after each night would lose meaning-based search for hours.
- Observation: GPU memory is shared and busy. On 2026-09-28 at 10:30, with the business LLM stopped, the GPU held Private ComfyUI (about 20 GB), a Private llama-server (about 25 GB), and Irodori speech (about 5 GB); the host had 121 GB with 59 GB available. The business LLM reserves 65 percent of GPU memory when it runs (`scripts/dgx-local-llm-system/model-registry.examples/business_qwen36_27b_nvfp4/manifest.json`, `gpuMemoryUtilization: 0.65`, `maxNumSeqs: 4`).

## Decision Log

- Decision: day and night have different jobs. Night does enrichment, document embedding, and linking; day does only question embedding and answering.
  Rationale: owner direction on 2026-09-28, and the measured morning slowdown.
  Date/Author: 2026-09-28, owner and Claude.
- Decision: write this plan before changing the DGX.
  Rationale: the embedding service is CPU-only because GPU memory safety was not proven, and another task was changing the DGX at the time.
  Date/Author: 2026-09-28, Claude.
- Open D1 (owner): GPU memory for query embedding. Proposal: reserve about 1.5 GB for the embedding model on the GPU at all times, and if the GPU cannot give it, fall back to the current CPU process instead of failing. The reserve is small next to the 65 percent business pool and the Private models, but it is permanent.
- Open D2 (owner): which links matter first. Proposal: nonconformity to production schedule by order number (製番) and part number, then nonconformity to knowledge procedures by part and process.
- Open D3 (owner): night time split. Proposal: 22:00 to 04:00 enrichment, 04:00 to 06:00 embedding catch-up and linking, so the morning starts with a finished index. Private tasks that need the DGX at night (video, roleplay) take priority through the existing lease and pause the night flow.

## Outcomes & Retrospective

Not started.

## Context and Orientation

The DGX Spark is one machine with 20 CPU cores and about 121 GB of memory that the CPU and the GPU share. Two repositories touch it. This repository (`RaspberryPiSystem_002`) owns the business Pi 5, the business Hermes code, and the business LLM model profile. The repository `denkoushi/DGXSparkControlPlane` owns what runs on the DGX: the lease (which task may use the GPU), the business proxy, and the text embedding service. Changes to the DGX go to that repository first, with backward compatibility, and the Pi 5 side follows (see `AGENTS.md`, DGX Spark Control Plane Boundary).

Enrichment is produced by `scripts/hermes-search/retrieval/enrichment-runner.mjs`, started by the API process on the Pi 5 (`apps/api/src/services/assembly/hermes-search-trial.service.ts`) every 5 minutes inside the window in `HERMES_RETRIEVAL_ENRICHMENT_WINDOW` (now `22-6`). It calls the business LLM on the DGX and writes `retrieval-enrichment.jsonl` on the Pi 5. Details and history are in `docs/plans/hermes-dgx-retrieval-enrichment.md`.

The meaning-based search keeps one vector per record in `retrieval-dense-dgx.bin` on the Pi 5. `createDenseRuntime` in `scripts/hermes-search/retrieval/dense-dgx.mjs` refreshes it after each corpus reload by sending changed records in batches of 8 to the DGX, and embeds each question with an 800 ms budget (`DEFAULT_EMBED_BUDGET_MS` in `scripts/hermes-search/retrieval/query-embedding.mjs`). On a timeout the answer uses word matching only and the receipt log line `Hermes search receipt` records `vectorStatus: timeout`.

On the DGX, the embedding service is `dgx-control-business-text-embedding.service`, a llama.cpp server on port 38110 with the Qwen3-Embedding-0.6B model. `agents/dgx/dgx_control/text_embedding.py` in the Control Plane sets `GPU_LAYERS = 0` and `--parallel 2`, and its header explains why: the Control Plane cannot prove that a second GPU-resident model is safe beside the business LLM budget and the Private models, so the service takes no GPU memory. The model weights are about 0.64 GB.

Accuracy results for each change are logged in `docs/plans/hermes-retrieval-accuracy-log.md`.

## Plan of Work

### Milestone 1: day-time protection on the Pi 5

Keep question embedding usable even before the DGX changes. In `createDenseRuntime`, run a large document refresh only inside the enrichment window, and outside it embed at most a small number of changed records per refresh with a pause between batches, so a Chat question finds a free slot. At the end, a morning with thousands of changed records still answers paraphrased questions with `vectorStatus: ok`, and the backlog finishes the next night. This is a change in this repository only.

### Milestone 2: GPU query embedding on the DGX

In the Control Plane, make the embedding service use the GPU when decision D1 allows it: load the model with all layers on the GPU, check at start that the memory is available, and fall back to the current CPU command when it is not. Then measure question embedding from the Pi 5 while document embedding runs; the target is under 100 ms. Raise the Pi 5 budget only if the measurement needs it. This milestone is a Control Plane pull request first and a Pi 5 setting change second, as the boundary requires.

### Milestone 3: one night flow for every source

Replace the separate triggers with one ordered night flow on the Pi 5: enrich changed records, embed them, then link them, and write one status file per stage. The flow takes its list of sources and fields from the source catalog, so it does not contain nonconformity-specific code. At the end, the status files show each stage finishing inside the window, and the morning index matches the enrichment store.

### Milestone 4: links between sources

Add a link stage that records, for each record, related records in other sources, first by exact keys (order number, part number), then by LLM-suggested links that must quote the matching text from both records. Chat can then show, for a nonconformity, the related schedule row or procedure. The first link pair follows decision D2.

### Milestone 5: adding a source without new night code

Show that a new source needs only its catalog entry and source label. Add one small source through the catalog and observe the night flow enrich, embed, and link it with no change to the night flow code.

## Concrete Steps

Measurements used above can be repeated. From the Mac, with the owner's tunnel open (`ssh -N -L 38110:127.0.0.1:38110 ubudgxkoushi@100.118.82.72`):

    curl -s -o /dev/null -w "%{time_total}\n" -H 'content-type: application/json' \
      -d '{"model":"Qwen/Qwen3-Embedding-0.6B","input":["塗装不良"]}' http://127.0.0.1:38110/v1/embeddings

On the DGX, read-only: `uptime`, `top -b -n1 -o %CPU`, `free -g`, and `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv`.

From the Pi 5, the last answer receipts: `docker logs --since 30m <api container> | grep "Hermes search receipt"`, and read `timings.vectorStatus`.

## Validation and Acceptance

The plan is done when, on a morning after a full-corpus night run, ten paraphrased Chat questions all show `vectorStatus: ok` with question embedding under 100 ms, the stage status files show every stage finished inside the window, and a newly added source is enriched, embedded, and linked by the same night flow. Accuracy for each milestone is compared with a same-day baseline and logged in `docs/plans/hermes-retrieval-accuracy-log.md`.

## Idempotence and Recovery

Every stage works on changed records only and can be re-run. The CPU embedding path stays as the fallback for Milestone 2. The Pi 5 settings added by these milestones follow the existing maintenance route, where leaving a variable out keeps the current value.

## Artifacts and Notes

2026-09-28 measurements, question embedding while about 1,000 records were re-embedded:

    from the Pi 5 (10 calls, ms): 891 1017 5054 976 935 976 4863 885 959 5179
    directly on the DGX (s): 4.40 1.66 4.52 1.60 4.83 1.49 5.36 1.66 4.86 1.54

## Interfaces and Dependencies

Milestone 2 depends on `denkoushi/DGXSparkControlPlane` (`agents/dgx/dgx_control/text_embedding.py` and `infra/systemd/dgx-control-business-text-embedding.service`). Milestones 1, 3, 4, and 5 change `scripts/hermes-search/retrieval/` and the source catalog in this repository.
