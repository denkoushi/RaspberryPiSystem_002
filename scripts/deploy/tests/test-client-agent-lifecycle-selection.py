#!/usr/bin/env python3
"""Regression checks for Pi4 agent build/recreate/no-build selection."""
from __future__ import annotations

from pathlib import Path

from jinja2 import Environment


ROOT = Path(__file__).resolve().parents[3]


def assert_change_classification_is_staged() -> None:
    path = ROOT / 'infrastructure/ansible/roles/common/tasks/main.yml'
    text = path.read_text(encoding='utf-8')
    image_task = '- name: Classify client agent image changes'
    runtime_task = '- name: Classify client agent runtime changes'
    image_start = text.index(image_task)
    runtime_start = text.index(runtime_task)
    if image_start >= runtime_start:
        raise AssertionError('agent image change classification must precede runtime classification')
    image_block = text[image_start:runtime_start]
    if (
        'nfc_agent_runtime_recreate_needed:' in image_block
        or 'barcode_agent_runtime_recreate_needed:' in image_block
    ):
        raise AssertionError('runtime facts must not reference image facts in the same set_fact task')


def command_template(name: str) -> str:
    path = ROOT / 'infrastructure/ansible/roles/client/tasks' / name
    text = path.read_text(encoding='utf-8')
    marker = '    cd "{{ repo_path }}"\n'
    start = text.index(marker) + len(marker)
    end = text.index('\n  args:', start)
    return text[start:end]


def render(template: str, *, image: bool, recreate: bool) -> str:
    return Environment().from_string(template).render(
        repo_path='/opt/RaspberryPiSystem_002',
        nfc_agent_image_build_needed=image,
        nfc_agent_runtime_recreate_needed=recreate,
        barcode_agent_image_build_needed=image,
        barcode_agent_runtime_recreate_needed=recreate,
    ).strip()


def assert_selection(template: str, *, image: bool, recreate: bool, expected: str) -> None:
    rendered = render(template, image=image, recreate=recreate)
    if expected not in rendered:
        raise AssertionError(f'expected {expected!r} for image={image}, recreate={recreate}: {rendered!r}')


def main() -> None:
    assert_change_classification_is_staged()
    for filename in ('nfc-agent-lifecycle.yml', 'barcode-agent-lifecycle.yml'):
        template = command_template(filename)
        assert_selection(template, image=True, recreate=True, expected='up -d --build')
        assert_selection(template, image=False, recreate=True, expected='up -d --force-recreate --no-build')
        assert_selection(template, image=False, recreate=False, expected='up -d --no-build')
    print('PASS: client agent lifecycle command selection')


if __name__ == '__main__':
    main()
