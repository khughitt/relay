"""Bounded private terminal driver. Never attaches to the live desktop."""
import ctypes
import errno
import fcntl
import json
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import time

spec = json.load(sys.stdin)
# --input-script FILE: [{afterMs, text}], each typed at afterMs from start, then Enter 300 ms later
# (a slower Enter keeps the TUI from reading text plus Enter as one paste).
inputs = []
if sys.argv[1:2] == ['--input-script'] and len(sys.argv) == 3:
    with open(sys.argv[2]) as f:
        inputs = json.load(f)
    if not isinstance(inputs, list) or len(inputs) > 16 or not all(
            isinstance(x, dict) and isinstance(x.get('afterMs'), int) and 0 <= x['afterMs'] <= 600000
            and isinstance(x.get('text'), str) and 0 < len(x['text']) <= 4096 and '\r' not in x['text']
            and '\n' not in x['text'] for x in inputs):
        sys.exit('invalid input script')
elif sys.argv[1:]:
    sys.exit('usage: pty.py [--input-script FILE] < spec.json')
pending = sorted(({'afterMs': x['afterMs'], 'text': x['text'], 'stage': 0} for x in inputs),
                 key=lambda x: x['afterMs'])
sent = []
ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)  # Linux child subreaper: reap grandchildren too.
master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 45, 150, 0, 0))
child = subprocess.Popen(spec['argv'], cwd=spec['cwd'], stdin=slave, stdout=slave,
                         stderr=slave, start_new_session=True)
os.close(slave)
interrupted = False

def interrupt(_signum, _frame):
    global interrupted
    interrupted = True

signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)
started = time.monotonic()
deadline = started + spec['timeout']
reason = 'exited'
size = 0
done_at = None
sent_enter = False
with open(spec['output'], 'wb') as out:
    try:
        while child.poll() is None:
            now = time.monotonic()
            if interrupted:
                reason = 'interrupted'
                break
            if now >= deadline:
                reason = 'deadline'
                break
            if spec.get('done') and os.path.exists(spec['done']):
                done_at = done_at or now
                if now - done_at > 1:
                    reason = 'turn-complete'
                    break
            elapsed_ms = (now - started) * 1000
            for item in pending:
                if item['stage'] == 0 and elapsed_ms >= item['afterMs']:
                    os.write(master, item['text'].encode())
                    item['stage'], item['typedMs'] = 1, round(elapsed_ms)
                elif item['stage'] == 1 and elapsed_ms >= item['typedMs'] + 300:
                    os.write(master, b'\r')
                    item['stage'] = 2
                    sent.append({'afterMs': item['afterMs'], 'typedMs': item['typedMs'],
                                 'enterMs': round(elapsed_ms)})
            if select.select([master], [], [], 0.05)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    raise
                size += len(data)
                if size > 4 * 1024 * 1024:
                    reason = 'output-limit'
                    break
                out.write(data)
                out.flush()
                if b'\x1b[6n' in data:
                    os.write(master, b'\x1b[1;1R')
                if b'\x1b[c' in data:
                    os.write(master, b'\x1b[?1;2c')
                # Only dismiss the unsupported synthetic-model notice.
                if not sent_enter and b'press enter' in data.lower():
                    os.write(master, b'\r')
                    sent_enter = True
    finally:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        until = time.monotonic() + 1
        while time.monotonic() < until:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    time.sleep(0.01)
                    continue
            except ChildProcessError:
                break
        os.close(master)
survivors = []
try:
    os.killpg(child.pid, 0)
    survivors.append(child.pid)
except ProcessLookupError:
    pass
print(json.dumps({'reason': reason, 'code': child.returncode,
                  'durationMs': round((time.monotonic() - started) * 1000), 'inputs': sent,
                  'cleanup': {'ownedPids': [child.pid], 'survivors': survivors}}))
