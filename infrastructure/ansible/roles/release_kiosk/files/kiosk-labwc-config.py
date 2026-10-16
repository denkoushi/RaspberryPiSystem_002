#!/usr/bin/env python3
"""Add the kiosk window rule without reserializing the user's labwc XML."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET


TITLEBAR_MARKER = "<!-- BEGIN ANSIBLE MANAGED: kiosk-titlebar -->"
TITLEBAR_RULE = (
    TITLEBAR_MARKER
    + '\n    <windowRule identifier="Chromium" serverDecoration="no" />\n'
    + "    <!-- END ANSIBLE MANAGED: kiosk-titlebar -->"
)
TITLEBAR_BLOCK = (
    TITLEBAR_MARKER
    + '\n  <windowRules>\n    <windowRule identifier="Chromium" serverDecoration="no" />'
    + "\n  </windowRules>\n  <!-- END ANSIBLE MANAGED: kiosk-titlebar -->"
)
SHORTCUT_BLOCK = re.compile(
    r"<!--\s*BEGIN ANSIBLE MANAGED: show-kiosk-panel\s*-->.*?"
    r"<!--\s*END ANSIBLE MANAGED: show-kiosk-panel\s*-->",
    re.DOTALL,
)
# Comments and quoted attributes must not be mistaken for structural tags.
TOKENS = re.compile(
    r"<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|<![^>]*>|"
    r"</?[A-Za-z_][\w:.-]*(?:[^>\"']|\"[^\"]*\"|'[^']*')*>",
    re.DOTALL,
)


def root_sections(text: str) -> tuple[re.Match, dict[str, tuple[re.Match, re.Match]]]:
    """Find the root close and its direct children, retaining text offsets."""
    stack: list[tuple[str, re.Match]] = []
    children: dict[str, tuple[re.Match, re.Match]] = {}
    for token in TOKENS.finditer(text):
        value = token.group()
        if value.startswith(("<!", "<?")):
            continue
        name = re.match(r"</?([\w:.-]+)", value).group(1)
        if value.startswith("</"):
            if not stack or stack[-1][0] != name:
                raise ValueError("Mismatched XML tags")
            _, opening = stack.pop()
            if not stack:
                if name not in ("openbox_config", "labwc_config"):
                    raise ValueError("Expected an openbox_config or labwc_config root")
                return token, children
            if len(stack) == 1:
                children.setdefault(name, (opening, token))
        elif value.endswith("/>"):
            if len(stack) == 1:
                children.setdefault(name, (token, token))
        else:
            stack.append((name, token))
    raise ValueError("No closing labwc root element found")


def insert_child(text: str, section: tuple[re.Match, re.Match], content: str) -> str:
    opening, closing = section
    if opening is closing:
        name = re.match(r"<([\w:.-]+)", opening.group()).group(1)
        return (
            text[: opening.start()]
            + opening.group()[:-2] + ">\n    " + content
            + "\n  </" + name + ">" + text[opening.end() :]
        )
    return text[: opening.end()] + "\n    " + content + text[opening.end() :]


def update_config(text: str) -> str:
    root_close, children = root_sections(text)
    trailing = text[root_close.end() :]
    misplaced = SHORTCUT_BLOCK.findall(trailing)
    if misplaced:
        # Remove only the misplaced managed block; other trailing text still
        # undergoes XML validation and is never silently discarded.
        text = text[: root_close.end()] + SHORTCUT_BLOCK.sub("", trailing)
        shortcut = "\n    ".join(misplaced)
        if "keyboard" in children:
            text = insert_child(text, children["keyboard"], shortcut)
        else:
            text = (
                text[: root_close.start()]
                + "\n  <keyboard>\n    " + shortcut + "\n  </keyboard>\n"
                + text[root_close.start() :]
            )

    root_close, children = root_sections(text)
    if TITLEBAR_MARKER not in text[: root_close.start()]:
        if "windowRules" in children:
            text = insert_child(text, children["windowRules"], TITLEBAR_RULE)
        else:
            text = (
                text[: root_close.start()]
                + "\n  " + TITLEBAR_BLOCK + "\n"
                + text[root_close.start() :]
            )
    ET.fromstring(text)
    return text


def edit_file(path: Path) -> bool:
    # newline="" preserves CRLF and all untouched text exactly.
    with path.open(encoding="utf-8", newline="") as source:
        original = source.read()
    updated = update_config(original)
    if updated == original:
        return False
    with path.open("w", encoding="utf-8", newline="") as target:
        target.write(updated)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        changed = edit_file(args.path)
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"kiosk labwc config: {error}", file=sys.stderr)
        return 1
    print("changed" if changed else "unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
