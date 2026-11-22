"""Ansible の task YAML を辿る共通部品(scripts/deploy/tests のテストで使う)。"""

BLOCK_KEYS = ("block", "rescue", "always", "tasks", "pre_tasks", "post_tasks", "handlers")


def iter_tasks(node):
    if isinstance(node, list):
        for item in node:
            yield from iter_tasks(item)
    elif isinstance(node, dict):
        yield node
        for key in BLOCK_KEYS:
            if key in node:
                yield from iter_tasks(node[key])
