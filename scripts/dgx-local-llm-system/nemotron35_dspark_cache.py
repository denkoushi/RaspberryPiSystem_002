"""Explicit preparation and offline validation for the pinned Nemotron pair."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import subprocess
from pathlib import Path


MODEL_ID = "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4"
MODEL_REVISION = "bee7596271d1495f6992ae224aefde4410e816b8"
DRAFT_ID = MODEL_ID + "-DSpark"
DRAFT_REVISION = "8a0177116d138011e63103110f136ec0ca09ebbf"
IMAGE = "vllm/vllm-openai:v0.27.1@sha256:1c8e60a0841b333c700488cb029d3664807249da0c071e862191b00fe34b228c"
DEFAULT_CACHE = "/srv/dgx/system-prod/data/hf-cache"
# Conservative preparation budget including image extraction and temporary
# files; this is not a measured runtime RAM requirement.
REQUIRED_FREE_GIB = 70


def snapshot_path(cache: Path, repo_id: str, revision: str) -> Path:
    return cache / "hub" / ("models--" + repo_id.replace("/", "--")) / "snapshots" / revision


def verify_snapshot(snapshot: Path, *, require_tokenizer: bool = True) -> None:
    """Check local metadata and weight lengths without scanning 23 GB of data.

    Hub verifies the downloaded blobs. Startup checks detect missing shards,
    dangling links and truncated safetensors, but are not a full checksum audit.
    """
    try:
        if not snapshot.is_absolute() or not snapshot.is_dir():
            raise ValueError("absolute local snapshot directory is required")
        metadata = ["config.json", "hf_quant_config.json"]
        if require_tokenizer:
            metadata.extend(("tokenizer_config.json", "tokenizer.json"))
            if not (snapshot / "chat_template.jinja").read_text().strip():
                raise ValueError("empty chat template")
        for name in metadata:
            if not isinstance(json.loads((snapshot / name).read_text()), dict):
                raise ValueError(f"invalid {name}")
        index = snapshot / "model.safetensors.index.json"
        if index.exists():
            weight_map = json.loads(index.read_text()).get("weight_map")
            if not isinstance(weight_map, dict) or not weight_map:
                raise ValueError("empty weight index")
            weights = set(weight_map.values())
        else:
            weights = {"model.safetensors"}
        for name in weights:
            if not isinstance(name, str) or Path(name).name != name or not name.endswith(".safetensors"):
                raise ValueError("invalid weight filename")
            weight = snapshot / name
            size = weight.stat().st_size
            with weight.open("rb") as handle:
                header_size = struct.unpack("<Q", handle.read(8))[0]
                if not 0 < header_size <= min(size - 8, 100_000_000):
                    raise ValueError(f"invalid safetensors header: {name}")
                header = json.loads(handle.read(header_size))
            ends = [value["data_offsets"][1] for key, value in header.items() if key != "__metadata__"]
            if not ends or max(ends) + header_size + 8 != size:
                raise ValueError(f"truncated or invalid safetensors: {name}")
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError, struct.error) as error:
        raise SystemExit(f"model snapshot incomplete: {snapshot}: {error}") from error


def prepare(action: str, cache: Path) -> None:
    if not cache.is_absolute():
        raise SystemExit("cache directory must be absolute")
    models = ((MODEL_ID, MODEL_REVISION), (DRAFT_ID, DRAFT_REVISION))
    if action == "plan":
        print(json.dumps({
            "image": IMAGE,
            "requiredFreeGiB": REQUIRED_FREE_GIB,
            "snapshots": [str(snapshot_path(cache, repo, rev)) for repo, rev in models],
        }, indent=2))
        return
    if action == "fetch":
        parent = cache
        while not parent.exists():
            parent = parent.parent
        if shutil.disk_usage(parent).free < REQUIRED_FREE_GIB * 1024**3:
            raise SystemExit(f"need at least {REQUIRED_FREE_GIB} GiB free for preparation under {parent}")
        subprocess.run(["docker", "pull", IMAGE], check=True)
        cache.mkdir(parents=True, exist_ok=True)
        # Use the pinned runtime's Hub client; do not install packages on the
        # host. No GPU, ports, services or active-model state are touched.
        download_code = (
            "from huggingface_hub import snapshot_download; import sys; "
            "snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], max_workers=4)"
        )
        for repo, rev in models:
            subprocess.run([
                "docker", "run", "--rm", "--pull", "never",
                "--user", f"{os.getuid()}:{os.getgid()}",
                "--env", "HF_HOME=/hf", "--env", "HF_TOKEN",
                "--volume", f"{cache}:/hf", "--entrypoint", "python3", IMAGE,
                "-c", download_code, repo, rev,
            ], check=True)
    for repo, rev in models:
        path = snapshot_path(cache, repo, rev)
        verify_snapshot(path, require_tokenizer=repo == MODEL_ID)
        print(f"snapshot_complete=true path={path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "fetch", "verify"))
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("BLUE_HF_CACHE_DIR", DEFAULT_CACHE)))
    args = parser.parse_args()
    prepare(args.action, args.cache_dir)


if __name__ == "__main__":
    main()
