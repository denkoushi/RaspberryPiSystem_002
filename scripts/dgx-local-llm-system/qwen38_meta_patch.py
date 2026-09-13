"""Patch the pinned GDN constructor to respect PLE's meta initialization."""
from pathlib import Path
import subprocess
import sys

GDN_PATH = '/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/mamba/gdn/qwen_gdn_linear_attn.py'
OLD = '            device=current_platform.current_device(),'
NEW = '            device=self.dt_bias.device,'


def patch_source(source: str) -> str:
    # dt_bias is allocated in the caller's device context just above the norm:
    # meta for PLE structure discovery, CUDA for the real GPU model.
    if source.count(OLD) != 1 or 'self.dt_bias = nn.Parameter(' not in source:
        raise ValueError('unexpected pinned GDN source; refusing to patch')
    patched = source.replace(OLD, NEW, 1)
    compile(patched, GDN_PATH, 'exec')
    return patched


def main() -> None:
    image, destination = sys.argv[1:]
    source = subprocess.run(
        ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
         '--entrypoint', 'cat', image, GDN_PATH],
        check=True, capture_output=True, text=True, timeout=30,
    ).stdout
    patched = patch_source(source)
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(patched, encoding='utf-8')
    temporary.replace(target)


if __name__ == '__main__':
    main()
