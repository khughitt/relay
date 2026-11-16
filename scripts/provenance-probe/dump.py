"""Record this process's ancestry from /proc for the Codex process-shape probe.

Usage: dump.py POINT STEP. Writes receipts/POINT-STEP-PID.json beside this file, then
receipts/POINT-STEP.done. Reads /proc only; prints nothing.
"""
import json
import math
import os
import sys
import time


def read(path):
    with open(path) as f:
        return f.read()


def row(pid):
    stat = read(f'/proc/{pid}/stat')
    comm = stat[stat.index('(') + 1:stat.rindex(')')]
    fields = stat[stat.rindex(')') + 2:].split()
    status = read(f'/proc/{pid}/status')
    nspid = next((line.split()[1:] for line in status.splitlines() if line.startswith('NSpid:')), [])
    try:
        exe = os.readlink(f'/proc/{pid}/exe')
    except OSError as e:
        exe = f'<{e.strerror}>'
    try:
        argv = [a for a in read(f'/proc/{pid}/cmdline').split('\0') if a][:16]
    except OSError:
        argv = []
    try:
        ns = os.readlink(f'/proc/{pid}/ns/pid')
    except OSError as e:
        ns = f'<{e.strerror}>'
    # stat fields after comm: state(0) ppid(1) ... starttime(19), i.e. stat field 22.
    return {'pid': pid, 'ppid': int(fields[1]), 'start': int(fields[19]), 'comm': comm, 'exe': exe,
            'argv': argv, 'pidNamespace': ns, 'isNamespaceInit': bool(nspid) and nspid[-1] == '1'}


def main():
    point, step = sys.argv[1], int(sys.argv[2])
    chain, pid = [], os.getpid()
    while pid > 0 and len(chain) < 64:
        try:
            chain.append(row(pid))
        except OSError:
            break
        pid = chain[-1]['ppid']
    before = math.floor(time.time() * 1000)
    uptime = read('/proc/uptime')
    after = math.floor(time.time() * 1000)
    me = chain[0]
    adopter = chain[1] if point == 'orphan-after-parent-exit' and len(chain) > 1 else None
    receipt = {**me, 'point': point, 'step': step,
               'subreaper': None if adopter is None else {k: adopter[k] for k in ('pid', 'comm', 'exe', 'isNamespaceInit')},
               'chain': chain, 'env': {'CODEX_THREAD_ID': os.environ.get('CODEX_THREAD_ID')},
               'clkTck': os.sysconf('SC_CLK_TCK'),
               'uptime': {'wallBeforeMs': before, 'uptimeText': uptime.strip(), 'wallAfterMs': after}}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'receipts')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, f'{point}-{step}-{me["pid"]}.json'), 'x') as f:
        json.dump(receipt, f, indent=1)
    with open(os.path.join(out, f'{point}-{step}.done'), 'w') as f:
        f.write('done')


main()
