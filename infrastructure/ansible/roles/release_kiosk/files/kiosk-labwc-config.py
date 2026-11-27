#!/usr/bin/env python3
"""Add the kiosk window rule and keys without reserializing the user's labwc XML."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET


TITLEBAR_MARKER = "<!-- BEGIN ANSIBLE MANAGED: kiosk-titlebar -->"
# labwc up to 0.9 matches an Xwayland window by the WM_CLASS instance, which
# Chromium --app=https://<host>/kiosk?... sets to "<host>__kiosk". labwc 0.20,
# already offered by the Raspberry Pi archive, matches the class "Chromium".
KIOSK_WINDOW_RULES = (
    '<windowRule identifier="*__kiosk" serverDecoration="no" />',
    '<windowRule identifier="Chromium" serverDecoration="no" />',
)
TITLEBAR_RULE = (
    TITLEBAR_MARKER
    + "".join("\n    " + rule for rule in KIOSK_WINDOW_RULES) + "\n"
    + "    <!-- END ANSIBLE MANAGED: kiosk-titlebar -->"
)
TITLEBAR_BLOCK = (
    TITLEBAR_MARKER
    + "\n  <windowRules>"
    + "".join("\n    " + rule for rule in KIOSK_WINDOW_RULES)
    + "\n  </windowRules>\n  <!-- END ANSIBLE MANAGED: kiosk-titlebar -->"
)
MANAGED_TITLEBAR = re.compile(
    r"(<!--\s*BEGIN ANSIBLE MANAGED: kiosk-titlebar\s*-->.*?)"
    r"<windowRule\b[^>]*/>(?:\s*<windowRule\b[^>]*/>)*"
    r"(.*?<!--\s*END ANSIBLE MANAGED: kiosk-titlebar\s*-->)",
    re.DOTALL,
)
SHORTCUT_BLOCK = re.compile(
    r"<!--\s*BEGIN ANSIBLE MANAGED: show-kiosk-panel\s*-->.*?"
    r"<!--\s*END ANSIBLE MANAGED: show-kiosk-panel\s*-->",
    re.DOTALL,
)
# The panel's window list can lose the browser after the HDMI output goes away
# and comes back (monitor power saving), so the browser needs a close key that
# works without the panel or keyboard focus. kiosk-launch.sh execs Chromium,
# so the browser process started by kiosk-browser.service is the only
# "chromium" whose parent is PID 1; its helpers are children of it. pkill runs
# as the GUI user and can signal only that user's processes. Restart=always
# brings the browser back in 5s. No "$": labwc may expand variables itself.
CLOSE_BROWSER_BEGIN = "<!-- BEGIN ANSIBLE MANAGED: kiosk-close-browser -->"
CLOSE_BROWSER_END = "<!-- END ANSIBLE MANAGED: kiosk-close-browser -->"
CLOSE_BROWSER_KEY = "C-A-r"
CLOSE_BROWSER_COMMAND = "pkill -TERM -x -P 1 chromium"
CLOSE_BROWSER_BLOCK = (
    CLOSE_BROWSER_BEGIN
    + '\n    <keybind key="' + CLOSE_BROWSER_KEY + '">'
    + '\n      <action name="Execute">'
    + "\n        <command>" + CLOSE_BROWSER_COMMAND + "</command>"
    + "\n      </action>"
    + "\n    </keybind>"
    + "\n    " + CLOSE_BROWSER_END
)
MANAGED_CLOSE_BROWSER = re.compile(
    r"<!--\s*BEGIN ANSIBLE MANAGED: kiosk-close-browser\s*-->.*?"
    r"<!--\s*END ANSIBLE MANAGED: kiosk-close-browser\s*-->",
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


def add_to_section(text: str, name: str, content: str, new_section: str | None = None) -> str:
    """Insert content into a direct root child, creating the child when absent."""
    root_close, children = root_sections(text)
    if name in children:
        return insert_child(text, children[name], content)
    section = new_section or "<" + name + ">\n    " + content + "\n  </" + name + ">"
    return text[: root_close.start()] + "\n  " + section + "\n" + text[root_close.start() :]


def update_config(text: str) -> str:
    root_close, _ = root_sections(text)
    trailing = text[root_close.end() :]
    misplaced = SHORTCUT_BLOCK.findall(trailing)
    if misplaced:
        # Remove only the misplaced managed block; other trailing text still
        # undergoes XML validation and is never silently discarded.
        text = text[: root_close.end()] + SHORTCUT_BLOCK.sub("", trailing)
        text = add_to_section(text, "keyboard", "\n    ".join(misplaced))

    root_close, _ = root_sections(text)
    if TITLEBAR_MARKER in text[: root_close.start()]:
        # Earlier releases wrote a rule that never matched; rewrite it in place.
        text = MANAGED_TITLEBAR.sub(
            lambda match: match.group(1) + "\n    ".join(KIOSK_WINDOW_RULES) + match.group(2), text, count=1
        )
    else:
        text = add_to_section(text, "windowRules", TITLEBAR_RULE, TITLEBAR_BLOCK)

    root_close, _ = root_sections(text)
    if MANAGED_CLOSE_BROWSER.search(text[: root_close.start()]):
        text = MANAGED_CLOSE_BROWSER.sub(lambda _: CLOSE_BROWSER_BLOCK, text, count=1)
    else:
        text = add_to_section(text, "keyboard", CLOSE_BROWSER_BLOCK)
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
