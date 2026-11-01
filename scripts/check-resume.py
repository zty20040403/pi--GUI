"""实际在伪终端运行 pi -r，只打印是否看到测试对话，不输出私人列表。"""
import fcntl
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

cwd, marker = sys.argv[1:3]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
env = dict(os.environ, TERM="xterm-256color")
# Popen 关闭继承的描述符，整个子进程组单独管理，不能留下 pi 的工作进程。
child = subprocess.Popen(
    [env.get("PI_BIN", "pi"), "-r", "--tui-mode", "regular", "--offline"],
    cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
    start_new_session=True, close_fds=True,
)
os.close(slave)
output = ""
found = False
try:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline and child.poll() is None:
        if not select.select([master], [], [], 0.2)[0]:
            continue
        try:
            data = os.read(master, 65536).decode("utf-8", "replace")
        except OSError:
            break
        if "\x1b[6n" in data:
            os.write(master, b"\x1b[1;1R")
        output = (output + data)[-1000000:]
        clean = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", output)
        clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", clean)
        if marker in clean:
            found = True
            break
finally:
    # 必须杀整个独立进程组，pi 可能另外启动嵌入/后台工作进程。
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

if not found:
    print("终端 pi -r 验收失败：未在实际对话选择器中看到测试对话", file=sys.stderr)
    sys.exit(1)
print("终端 pi -r 验收通过：实际选择器显示了浏览器创建的同一对话")
