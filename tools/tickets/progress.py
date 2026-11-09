#!/usr/bin/env python3
"""Progress toward the MVP and toward the whole build.

The headline unit is the **feature** (docs/tickets/FEATURE_MAP.md): a thing a user can do, with its
backend and frontend together. A feature is done only when its `- **Status:**` is exactly `Done`;
`Backend done, UI outstanding` is not done. Two numbers: MVP features (`- **MVP:** yes`) and all
features.

The older per-ticket view is the detail layer (`--tickets`). "Toward the end" is every ticket in
docs/tickets/; "toward MVP" is the cut recorded in docs/MVP.md, read out of that document rather
than listed here. A ticket is done when its heading carries a `- **Status:** Done` line, which is
the same signal tickets_index.py reads.

Usage: progress.py [--list] [--tickets] [--write]
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


INCLUDED = re.compile(r"^## Included — (\d+) tickets\s*$", re.M)
SECTION_COUNT = re.compile(r"\((\d+)")


def parse_mvp_included(text: str) -> tuple[set[str], int, list[str]]:
    """(ids, declared total, problems) from the `## Included — N tickets` span of MVP.md.

    Only explicit ticket listings count: bold-led bullets (`- **T-191** ...`) and the items of the
    ` · `-separated items of a section's first paragraph, each of which opens with its id. Prose that names a ticket
    elsewhere (for example "T-201 stays deferred") is deliberately not scraped.
    Problems are mismatches between the parsed ids and the counts the document states, both per
    `###` section and in total.
    """
    head = INCLUDED.search(text)
    if not head:
        raise SystemExit("docs/MVP.md has no '## Included — N tickets' header")
    end = text.find("\n## ", head.end())
    span = text[head.end() : end if end != -1 else len(text)]
    declared = int(head.group(1))
    ids: set[str] = set()
    problems: list[str] = []
    for section in re.split(r"^### ", span, flags=re.M)[1:]:
        title, _, body = section.partition("\n")
        found: set[str] = set()
        for number, para in enumerate(re.split(r"\n\s*\n", body.strip())):
            if para.startswith("- "):
                for line in para.splitlines():
                    bullet = re.match(r"- \*\*([^*]+)\*\*", line)
                    if bullet:
                        found |= set(TICKET_ID.findall(bullet.group(1)))
            elif number == 0:  # the listing paragraph; later paragraphs are prose
                for item in re.sub(r"\s+", " ", para).split(" · "):
                    lead = re.match(r"(T-\d{3})\b", item)
                    if lead:
                        found.add(lead.group(1))
        stated = SECTION_COUNT.search(title)
        if stated and int(stated.group(1)) != len(found):
            problems.append(f"section '{title}' states {stated.group(1)} but lists {len(found)}")
        ids |= found
    if len(ids) != declared:
        problems.append(f"'## Included' states {declared} tickets but {len(ids)} were parsed")
    return ids, declared, problems


def mvp_ids() -> set[str]:
    """The ids listed in MVP.md's Included section. Errors loudly if they disagree with its counts."""
    if not MVP.exists():
        return set()
    ids, _, problems = parse_mvp_included(MVP.read_text())
    if problems:
        raise SystemExit("docs/MVP.md and tools/tickets/progress.py disagree:\n  " + "\n  ".join(problems))
    return ids


FEATURE_MAP = TICKETS / "FEATURE_MAP.md"
FEATURE_HEADING = re.compile(r"^#### (F-\d+) — (.+)$")
JOURNEY_HEADING = re.compile(r"^### Journey: (.+)$")
FEATURE_FIELD = re.compile(r"^- \*\*(Status|MVP|Depends on|Absorbs):\*\* (.*)$")
FEATURE_ID = re.compile(r"F-\d{3}")
BACKEND_ONLY = "Backend done, UI outstanding"


def parse_features(text: str) -> dict[str, dict]:
    """id -> {title, journey, status, mvp, deps, absorbs}, in document order."""
    feats: dict[str, dict] = {}
    journey, current = "?", None
    for line in text.splitlines():
        if m := JOURNEY_HEADING.match(line):
            journey, current = m.group(1), None
        elif m := FEATURE_HEADING.match(line):
            current = m.group(1)
            feats[current] = {"title": m.group(2), "journey": journey, "status": None, "mvp": None, "deps": [], "absorbs": []}
        elif current and (m := FEATURE_FIELD.match(line)):
            key, value = m.groups()
            if key == "Status":
                feats[current]["status"] = value.strip()
            elif key == "MVP":
                feats[current]["mvp"] = value.strip() == "yes"
            elif key == "Depends on":
                feats[current]["deps"] = FEATURE_ID.findall(value)
            else:
                feats[current]["absorbs"] = TICKET_ID.findall(value)
    bad = [f for f, d in feats.items() if d["status"] is None or d["mvp"] is None]
    if bad or not feats:
        raise SystemExit(f"FEATURE_MAP.md: features missing a Status or MVP bullet: {bad or 'no features found'}")
    return feats


def features() -> dict[str, dict]:
    return parse_features(FEATURE_MAP.read_text())


def bar(done: int, total: int, width: int = 34) -> str:
    filled = 0 if total == 0 else round(width * done / total)
    return "█" * filled + "·" * (width - filled)


def feature_numbers(feats: dict[str, dict]) -> dict:
    done = {f for f, d in feats.items() if d["status"] == "Done"}
    mvp = {f for f, d in feats.items() if d["mvp"]}
    return {
        "done": done,
        "mvp": mvp,
        "mvp_done": done & mvp,
        "backend_only": [f for f, d in feats.items() if d["status"] == BACKEND_ONLY],
        "remaining": [f for f in feats if f in mvp and f not in done],
    }


def feature_bars(feats: dict[str, dict]) -> list[str]:
    n = feature_numbers(feats)
    md, mt, td, tt = len(n["mvp_done"]), len(n["mvp"]), len(n["done"]), len(feats)
    return [
        f"MVP   {bar(md, mt)}  {md}/{mt}   ({md / mt:.0%})",
        f"Total {bar(td, tt)}  {td}/{tt}   ({td / tt:.0%})",
    ]


def ready_features(feats: dict[str, dict], ids) -> list[str]:
    done = feature_numbers(feats)["done"]
    return [f for f in ids if all(d in done for d in feats[f]["deps"])]


def ticket_bars(tickets, done: set[str], mvp: set[str]) -> list[str]:
    # Every done ticket counts toward the MVP milestone: the MVP ships when the work done so far
    # plus the remaining MVP cut is finished, not when only the listed ones are.
    mvp_target = len(done | mvp)
    return [
        f"MVP   {bar(len(done), mvp_target)}  {len(done)}/{mvp_target}  ({len(done) / mvp_target:.0%})",
        f"Total {bar(len(done), len(tickets))}  {len(done)}/{len(tickets)}  ({len(done) / len(tickets):.0%})",
    ]


def main() -> int:
    feats = features()
    n = feature_numbers(feats)
    print("\n".join(feature_bars(feats)))
    print()
    deferred = len(feats) - len(n["done"]) - len(n["remaining"])
    print(f"{len(n['remaining'])} MVP features left, {deferred} deferred past it.")
    print(f"{len(n['backend_only'])} are backend done with the UI outstanding: the cheapest route to working product.")

    tickets = all_tickets()
    done = {tid for tid, (_, is_done, _) in tickets.items() if is_done}
    mvp = mvp_ids()
    remaining = sorted(mvp - done)

    if "--tickets" in sys.argv:
        print("\nTicket layer (detail view, not the headline):")
        print("\n".join(ticket_bars(tickets, done, mvp)))
        print(f"{len(remaining)} MVP tickets left, {len(tickets) - len(done) - len(remaining)} deferred past it.")
    if "--list" in sys.argv:
        print("\nBackend done, UI outstanding (the engine exists, only the UI is missing):")
        for f in n["backend_only"]:
            print(f"  {f}  {feats[f]['title']}{'' if feats[f]['mvp'] else '  [not MVP]'}")
        rest = [f for f in n["remaining"] if feats[f]["status"] != BACKEND_ONLY]
        ready = set(ready_features(feats, rest))
        print(f"\nRemaining MVP features ({len(rest)}; * = every dependency is done):")
        for f in rest:
            print(f"  {f}{'*' if f in ready else ' '} {feats[f]['title']}")
        if "--tickets" in sys.argv:
            print("\nRemaining MVP tickets:")
            for tid in remaining:
                print(f"  {tid}  {tickets.get(tid, ('(not in docs/tickets)',))[0]}")
    if "--write" in sys.argv:
        write_page(feats, tickets, done, mvp, remaining)
        print(f"\nwrote {PAGE.relative_to(ROOT)}")
    return 0


PAGE = ROOT / "docs" / "PROGRESS.md"
DEPENDS = re.compile(r"^- \*\*Depends on:\*\* (.*)$")
STATUS = re.compile(r"^- \*\*Status(?::\*\*)? ?(.*)$")


def deps_and_status() -> tuple[dict[str, list[str]], dict[str, str]]:
    deps: dict[str, list[str]] = {}
    status: dict[str, str] = {}
    for path in sorted(TICKETS.glob("*.md")):
        current: str | None = None
        for line in path.read_text().splitlines():
            heading = HEADING.match(line)
            if heading:
                current = heading.group(1)
                deps[current] = []
            elif current and (m := DEPENDS.match(line)):
                deps[current] = TICKET_ID.findall(m.group(1))
            elif current and (m := STATUS.match(line)):
                status[current] = m.group(1)
    return deps, status


def write_page(feats, tickets, done: set[str], mvp: set[str], remaining: list[str]) -> None:
    """docs/PROGRESS.md: the page the owner reads. Regenerated by the build manager every run."""
    n = feature_numbers(feats)
    deps, status = deps_and_status()
    deps["T-183"] = [t for t in tickets if t != "T-183"]
    in_progress = {t for t, s in status.items() if not s.startswith("Done") and "in progress" in s.lower()}
    blocked = {t for t, s in status.items() if s.startswith("Blocked")}
    ready = sorted(
        t
        for t in tickets
        if t not in done and t not in blocked and all(d in done for d in deps.get(t, []))
    )
    lines = [
        "# Build progress",
        "",
        "Generated by `pnpm progress --write`; do not edit by hand. The build manager regenerates it",
        "after every run. The run-by-run history is [`manager/RUN_LOG.md`](manager/RUN_LOG.md), and the plan",
        "behind it is [`BUILD_PLAN.md`](BUILD_PLAN.md). The unit of work is the feature, defined in",
        "[`tickets/FEATURE_MAP.md`](tickets/FEATURE_MAP.md); a feature is done only when a user can do the",
        "thing in an app.",
        "",
        "```",
        *feature_bars(feats),
        "```",
        "",
        f"{len(n['remaining'])} MVP features left, {len(feats) - len(n['done']) - len(n['remaining'])} deferred past it.",
        "",
        "## Backend done, UI outstanding",
        "",
        "The engine exists and only the UI is missing, so these are the highest-value work available.",
        "",
    ]

    def ftable(ids) -> None:
        ids = list(ids)
        if not ids:
            lines.extend(["None.", ""])
            return
        lines.extend(["| Feature | Title | Journey | MVP |", "| ------- | ----- | ------- | --- |"])
        for f in ids:
            d = feats[f]
            lines.append(f"| {f} | {d['title']} | {d['journey']} | {'yes' if d['mvp'] else ''} |")
        lines.append("")

    ftable(n["backend_only"])
    lines.extend(["## By journey", "", "| Journey | Done | Total | MVP done | MVP total |", "| ------- | ---- | ----- | -------- | --------- |"])
    journeys: dict[str, list[str]] = {}
    for f, d in feats.items():
        journeys.setdefault(d["journey"], []).append(f)
    for journey, ids in journeys.items():
        mvp_ids_j = [f for f in ids if feats[f]["mvp"]]
        lines.append(
            f"| {journey} | {sum(f in n['done'] for f in ids)} | {len(ids)} "
            f"| {sum(f in n['done'] for f in mvp_ids_j)} | {len(mvp_ids_j)} |"
        )
    open_mvp = [f for f in n["remaining"] if feats[f]["status"] != BACKEND_ONLY]
    lines.extend(["", "## Ready features (every dependency done), MVP first", ""])
    ftable(
        sorted(
            ready_features(feats, [f for f in feats if f not in n["done"] and f not in n["backend_only"]]),
            key=lambda f: (not feats[f]["mvp"], f),
        )
    )
    lines.extend(["## Remaining MVP features", ""])
    ftable(open_mvp)
    lines.extend(
        [
            "## Ticket layer (detail view)",
            "",
            "The same work counted per ticket. Useful for the detail in `docs/tickets/`, not the headline:",
            "it counts backend and frontend layers separately, which is how the build drifted.",
            "",
            "```",
            *ticket_bars(tickets, done, mvp),
            "```",
            "",
            f"{len(remaining)} MVP tickets left, {len(tickets) - len(done) - len(remaining)} deferred past it.",
        ]
    )

    def table(title: str, ids) -> None:
        lines.extend(["", f"### {title}", ""])
        if not ids:
            lines.append("None.")
            return
        lines.extend(["| Ticket | Title | MVP |", "| ------ | ----- | --- |"])
        for t in ids:
            lines.append(f"| {t} | {tickets[t][0]} | {'yes' if t in mvp else ''} |")

    table("Tickets in progress", sorted(in_progress))
    table("Tickets ready to start (MVP first)", sorted(ready, key=lambda t: (t not in mvp, t)))
    table("Tickets blocked on an owner decision", sorted(blocked))
    table("Remaining MVP tickets", remaining)
    PAGE.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
