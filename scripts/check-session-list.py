"""比较真实 pi -r 的 All 选择器文件列表；期望路径通过 stdin，仅在内存中使用。"""
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

expected = {pathlib.Path(path).name for path in json.loads(sys.stdin.read())}
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 100, 1000, 0, 0))
child = subprocess.Popen([os.environ.get("PI_BIN", "pi"), "-r", "--tui-mode", "regular", "--offline"], cwd=sys.argv[1],
                         env=dict(os.environ, TERM="xterm-256color"), stdin=slave, stdout=slave, stderr=slave,
                         start_new_session=True, close_fds=True)
os.close(slave)
output = ""
pattern = r"\d{4}-\d{2}-\d{2}[^\s/]*?\.jsonl"

def capture(seconds):
    global output
    end = time.monotonic() + seconds
    while time.monotonic() < end and child.poll() is None:
        if not select.select([master], [], [], 0.1)[0]:
            continue
        try:
            part = os.read(master, 65536).decode("utf8", "replace")
        except OSError:
            break
        if "\x1b[6n" in part:
            os.write(master, b"\x1b[1;1R")
        output = (output + part)[-2000000:]
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)

observed = set()
all_visible = False
try:
    initial = capture(2)
    if "Resume Session (All)" not in initial:
        output = ""
        os.write(master, b"\t")
    text = capture(2)
    all_visible = "Resume Session (All)" in text or "Resume Session (All)" in initial
    if not re.findall(pattern, text):
        os.write(master, b"\x10")  # Ctrl+P：选择器显示对话路径，不保存配置。
    unchanged = 0
    for _ in range(30):
        text = capture(0.5)
        new = set(re.findall(pattern, text))
        prior = len(observed)
        observed.update(new)
        unchanged = unchanged + 1 if len(observed) == prior else 0
        if unchanged >= 3:
            break
        os.write(master, b"\x1b[6~")  # PageDown：长列表继续向下检查。
finally:
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    os.close(master)

if not all_visible or observed != expected:
    print(f"终端 All 列表验收失败：期望 {len(expected)}、看到 {len(observed)}，缺少 {len(expected-observed)}，多出 {len(observed-expected)}", file=sys.stderr)
    sys.exit(1)
print(f"终端 All 列表验收通过：{len(observed)} 个真实对话文件与 API 完全一致（不打印私人标题或路径）")
