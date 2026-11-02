"""真正的交互式 pi 伪终端，用合成对话文件确认回复，不把终端/私人内容输出到日志。"""
import fcntl
import json
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

cwd, session_dir, session_id, marker = sys.argv[1:5]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
env = dict(os.environ, TERM="xterm-256color")
child = subprocess.Popen(
    [env.get("PI_BIN", "pi"), "--tui-mode", "regular", "--offline", "--no-tools",
     "--model", "cliproxy/gpt-6-luna", "--thinking", "low", "--session-dir", session_dir,
     "--session-id", session_id, "只回复 " + marker + "，不要工具。"],
    cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
    start_new_session=True, close_fds=True,
)
os.close(slave)
owned = None


def reply(expected, old_count=0):
    global owned
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline and child.poll() is None:
        if select.select([master], [], [], 0.1)[0]:
            data = os.read(master, 65536)
            if b"\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
        candidates = list(pathlib.Path(session_dir).glob("*_" + session_id + ".jsonl"))
        if not candidates:
            continue
        owned = candidates[0]
        try:
            lines = [json.loads(line) for line in owned.read_text().splitlines()]
        except (ValueError, OSError):
            continue
        messages = [line["message"] for line in lines if line.get("type") == "message" and line.get("message", {}).get("role") == "assistant"]
        if len(messages) <= old_count:
            continue
        message = messages[-1]
        text = "".join(part.get("text", "") for part in message.get("content", []) if part.get("type") == "text")
        if expected in text and message.get("stopReason") == "stop":
            if message.get("model") != "gpt-6-luna" or message.get("provider") != "cliproxy" or message.get("thinkingLevel") != "low":
                raise RuntimeError("终端测试未使用 Luna/low")
            return len(messages)
    raise RuntimeError("真正终端对话未按时完成合成回复")


try:
    count = reply(marker)
    print(json.dumps({"ready": True, "sessionPath": str(owned)}), flush=True)
    for line in sys.stdin:
        command = json.loads(line)
        if command.get("op") == "close":
            break
        if command.get("op") != "send":
            raise RuntimeError("未知终端测试命令")
        # 标准 bracketed paste 防止长文本被编辑器当快捷键，再用 Enter 提交。
        os.write(master, ("\x1b[200~" + command["message"] + "\x1b[201~\r").encode())
        count = reply(command["expect"], count)
        print(json.dumps({"replied": True}), flush=True)
except Exception:
    print("终端同步验收失败（原始终端内容已省略）", file=sys.stderr)
    sys.exit(1)
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
