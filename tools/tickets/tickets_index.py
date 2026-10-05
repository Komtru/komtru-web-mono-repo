import re,glob,json,sys
tickets={}; order=[]
for fn in sorted(glob.glob('docs/tickets/*.md')):
    epic=open(fn,encoding='utf-8').readline().lstrip('# ').strip()
    cur=None
    for l in open(fn,encoding='utf-8'):
        m=re.match(r'### (T-\d+) — (.*)',l)
        if m:
            cur=m.group(1); tickets[cur]={'title':m.group(2).strip(),'epic':epic,'file':fn,'deps':[],'status':'Not started'}; order.append(cur); continue
        if not cur: continue
        m=re.match(r'- \*\*Depends on:\*\* (.*)',l)
        if m: tickets[cur]['deps']=re.findall(r'T-\d+',m.group(1)); tickets[cur]['deps_raw']=m.group(1)
        m=re.match(r'- \*\*Status:\*\* (.*)',l)
        if m:
            st=m.group(1)
            tickets[cur]['status']='Done' if st.startswith('Done') else ('Blocked' if st.startswith('Blocked') else st)
            q=re.findall(r'Q\d+',st); 
            if q: tickets[cur]['status']+=' ('+', '.join(q)+')'
# T-183 depends on everything
tickets['T-183']['deps']=[t for t in order if t!='T-183']
errs=[f'{t} depends on unknown {d}' for t,v in tickets.items() for d in v['deps'] if d not in tickets]
# cycle check + levels
level={}
def lv(t,stack=()):
    if t in level: return level[t]
    if t in stack: raise SystemExit('CYCLE: '+' -> '.join(stack+(t,)))
    level[t]=1+max([lv(d,stack+(t,)) for d in tickets[t]['deps']] or [-1])
    return level[t]
for t in order: lv(t)
print('tickets:',len(order),'errors:',errs or 'none','max wave:',max(level.values()))
json.dump({'order':order,'tickets':tickets,'level':level},open(sys.argv[1],'w'))
