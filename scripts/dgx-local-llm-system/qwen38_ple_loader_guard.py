"""Keep the PLE offload worker on the lazy safetensors loader.

The worker reuses the engine's load config for its own CPU-side pass over the
whole checkpoint.  With a GPU-direct loader (instanttensor) chosen for the
main model, that pass would stage every shard through GPU memory a second
time, beside the main load, and run one Spark out of memory (upstream
MiaAI-Lab/Qwen3.8-Flash-Next-Single-DGX-Spark#82).  The recipe regenerates
worker.py from the image on every launch, so this is applied just before the
container starts.
"""
from pathlib import Path
import sys

MARKER = '# business-qwen38: PLE worker stays on the safetensors loader'
ANCHOR = '        loader = get_model_loader(load_config)\n'
GUARDED = (
    f'        {MARKER}\n'
    '        if load_config.load_format in ("instanttensor", "fastsafetensors"):\n'
    '            import copy\n'
    '\n'
    '            load_config = copy.copy(load_config)\n'
    '            load_config.load_format = "safetensors"\n'
    + ANCHOR
)


def guard_source(source: str) -> str:
    if MARKER in source:
        return source
    if source.count(ANCHOR) != 1:
        raise ValueError(f'expected exactly one PLE worker loader line, found {source.count(ANCHOR)}')
    guarded = source.replace(ANCHOR, GUARDED, 1)
    compile(guarded, 'worker.py', 'exec')
    return guarded


def main() -> None:
    (path_arg,) = sys.argv[1:]
    path = Path(path_arg)
    source = path.read_text(encoding='utf-8')
    guarded = guard_source(source)
    if guarded != source:
        temporary = path.with_suffix('.guard.tmp')
        temporary.write_text(guarded, encoding='utf-8')
        temporary.replace(path)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as exc:
        raise SystemExit(f'Qwen3.8 PLE loader guard failed: {exc}')
