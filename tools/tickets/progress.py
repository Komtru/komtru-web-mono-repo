#!/usr/bin/env python3
"""Progress toward the MVP and toward the whole build, from the tickets themselves.

Two numbers, because they answer different questions. "Toward the end" is every ticket in
docs/tickets/. "Toward MVP" is the cut recorded in docs/MVP.md — the ids are read out of that
document rather than listed here, so the scope decision lives in one place and this only counts.

A ticket is done when its heading carries a `- **Status:** Done` line, which is the same signal
tickets_index.py reads.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TICKETS = ROOT / "docs" / "tickets"
MVP = ROOT / "docs" / "MVP.md"

HEADING = re.compile(r"^### (T-\d+) — (.+)$")
DONE = re.compile(r"^- \*\*Status:\*\* Done")
TICKET_ID = re.compile(r"T-\d{3}")


def all_tickets() -> dict[str, tuple[str, bool, str]]:
    """id -> (title, done, epic)."""
    found: dict[str, tuple[str, bool, str]] = {}
    for path in sorted(TICKETS.glob("*.md")):
        epic = path.stem
        current: str | None = None
        for line in path.read_text().splitlines():
            heading = HEADING.match(line)
            if heading:
                current = heading.group(1)
                found[current] = (heading.group(2), False, epic)
            elif current and DONE.match(line):
                title, _, ep = found[current]
                found[current] = (title, True, ep)
    return found


def mvp_ids() -> set[str]:
    """The ids named in MVP.md's Included section."""
    if not MVP.exists():
        return set()
    text = MVP.read_text()
    start = text.find("## Included")
    end = text.find("## Dependency edits", start)
    if start == -1:
        return set()
    return set(TICKET_ID.findall(text[start : end if end != -1 else len(text)]))


def bar(done: int, total: int, width: int = 34) -> str:
    filled = 0 if total == 0 else round(width * done / total)
    return "█" * filled + "·" * (width - filled)


def main() -> int:
    tickets = all_tickets()
    done = {tid for tid, (_, is_done, _) in tickets.items() if is_done}
    mvp = mvp_ids()

    # Every done ticket counts toward the MVP milestone: the MVP ships when the work done so far
    # plus the remaining MVP cut is finished, not when only the listed ones are.
    mvp_target = len(done | mvp)
    mvp_done = len(done)
    remaining = sorted(mvp - done)

    print(f"MVP   {bar(mvp_done, mvp_target)}  {mvp_done}/{mvp_target}  ({mvp_done / mvp_target:.0%})")
    print(f"Total {bar(len(done), len(tickets))}  {len(done)}/{len(tickets)}  ({len(done) / len(tickets):.0%})")
    print()
    print(f"{len(remaining)} MVP tickets left, {len(tickets) - len(done) - len(remaining)} deferred past it.")

    if "--list" in sys.argv:
        print("\nRemaining MVP tickets:")
        for tid in remaining:
            title, _, epic = tickets.get(tid, ("(not in docs/tickets)", False, "?"))
            print(f"  {tid}  {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
