"""Rebuilds the ticket index section of docs/TICKETS.md from the parsed tickets JSON.
Usage: python3 regen_tickets_md.py <tickets.json>   (run from the repo or worktree root)"""
import json, sys, collections, os

d = json.load(open(sys.argv[1]))
T, order, L = d['tickets'], d['order'], d['level']


def status(t):
    s = T[t]['status']
    if s.startswith('Done') or s.startswith('Blocked'):
        return s
    return 'Ready' if all(T[x]['status'].startswith('Done') for x in T[t]['deps']) else 'Waiting'


def path(t):
    best = next((x for x in T[t]['deps'] if L[x] == L[t] - 1), None)
    return (path(best) if best else []) + [t]


crit = path(max((t for t in order if t != 'T-183'), key=lambda t: L[t]))
head = open('docs/TICKETS.md', encoding='utf-8').read().split('## Critical path')[0]
out = [
    head,
    '## Critical path\n\n',
    ' → '.join(crit)
    + f"\n\n{len(crit)} tickets deep; T-183 follows everything. Backend platform and identity gate everything; the trade, dispute and Park chain is the longest stretch after that.\n",
    """
## Ticket index

`Wave` is the earliest point a ticket can start given its dependencies (wave 0 has none). Tickets in the same wave are independent of each other and can run in parallel worktrees.

| ID | Title | Epic | Depends on | Wave | Status |
|---|---|---|---|---|---|
""",
]
for t in order:
    v = T[t]
    deps = 'every other ticket' if t == 'T-183' else (', '.join(v['deps']) or '—')
    if 'owner answer' in v.get('deps_raw', ''):
        deps += ' + owner answer'
    out.append(
        f"| [{t}](tickets/{os.path.basename(v['file'])}) | {v['title']} | {v['epic'].replace('Epic ', '')} | {deps} | {L[t]} | {status(t)} |\n"
    )
c = collections.Counter(status(t).split(' ')[0] for t in order)
out.append(f"\n**Totals:** {len(order)} tickets — " + ', '.join(f'{k} {v}' for k, v in sorted(c.items())) + ".\n")
open('docs/TICKETS.md', 'w', encoding='utf-8').write(''.join(out))
print(dict(c))
print('Ready:', [t for t in order if status(t) == 'Ready'])
