#!/usr/bin/env python3
"""Loopback bridge: the «پرسش از هرمس» add-on POSTs a page excerpt + a question here,
this process runs one Hermes turn and returns the answer.

The add-on cannot call the Hermes desktop backend directly (random port, session
token, loopback-origin CORS), so this fixed-port daemon is the seam.

  POST /ask    {"question", "page": {"url","title","text"}, "selection", "session"} -> {"answer","session"}
  GET  /health -> {"ok": true}

Self-check: python3 hermes_ask_bridge.py --selftest
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("HERMES_ASK_PORT", "8790"))
HERMES = os.environ.get("HERMES_BIN", os.path.expanduser("~/.local/bin/hermes"))
CTX_MAX = 30000
SEL_MAX = 12000
TEXT_MAX = 20000      # one message handed to an action
TRANSCRIPT_MAX = 60000  # whole panel conversation handed to a chat action
TIMEOUT = 240
# Tools are limited to `web` on purpose: the page text is untrusted input, so the
# ask-turn must not be able to touch the filesystem or a shell.
SESSION_RE = re.compile(r"^session_id:\s*(\S+)\s*$", re.M)

ACTIONS_PATH = Path(os.environ.get(
    "HERMES_ASK_ACTIONS", os.path.expanduser("~/.config/hermes-firefox-ask/actions.json")))
DEFAULT_ACTIONS = {
    "message": [
        {"label": "خلاصه", "prompt": "این متن را در سه جمله خلاصه کن."},
        {"label": "ترجمه", "prompt": "این متن را به فارسی روان ترجمه کن."},
        {"label": "ساده‌تر", "prompt": "این متن را ساده و کوتاه توضیح بده."},
    ],
    "chat": [
        {"label": "این صفحه چیست؟", "prompt": "این صفحه درباره چیست؟ در سه جمله خلاصه کن."},
        {"label": "نکات کلیدی", "prompt": "سه نکته کلیدی این صفحه را با جزئیات فهرست کن."},
    ],
}


def load_actions() -> dict:
    try:
        data = json.loads(ACTIONS_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return save_actions(DEFAULT_ACTIONS)


def save_actions(data: dict) -> dict:
    """Keep only well-formed {label, prompt} entries; write the file, return what was stored."""
    clean = {}
    for group in ("message", "chat"):
        items = data.get(group) if isinstance(data, dict) else None
        clean[group] = [
            {"label": str(item.get("label") or item.get("prompt", "")).strip()[:60],
             "prompt": str(item.get("prompt", "")).strip()[:2000]}
            for item in (items or [])
            if isinstance(item, dict) and str(item.get("prompt", "")).strip()
        ][:40]
    try:
        ACTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
        ACTIONS_PATH.write_text(json.dumps(clean, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass  # read-only config dir: the caller still gets the sanitized list
    return clean


PROMPT_HEAD = """کاربر در مرورگر این صفحه را باز کرده است:
نشانی: {url}
عنوان: {title}
"""


def build_prompt(payload: dict) -> str:
    page = payload.get("page") or {}
    selection = (payload.get("selection") or "").strip()
    text = (page.get("text") or "").strip()
    message = (payload.get("text") or "").strip()
    transcript = (payload.get("transcript") or "").strip()
    question = (payload.get("question") or "").strip()
    parts = []
    if transcript:
        # An action over the whole panel conversation: the page has nothing to do with it.
        parts.append("متن کامل گفتگوی کاربر با دستیار در این پنل (پرسش‌ها و پاسخ‌ها):\n<<<\n"
                     + transcript[:TRANSCRIPT_MAX] + "\n>>>")
    else:
        parts.append(PROMPT_HEAD.format(url=page.get("url", ""), title=page.get("title", "")))
        if message:
            parts.append("متنی که این درخواست درباره آن است (یک پیام از گفتگو):\n<<<\n"
                         + message[:TEXT_MAX] + "\n>>>")
        elif selection:
            parts.append("متن مورد نظر کاربر (بخشی از صفحه یا یکی از پیام‌های همین گفتگو):\n<<<\n"
                         + selection[:SEL_MAX] + "\n>>>")
        elif text:
            parts.append("متن صفحه (ممکن است ناقص باشد):\n<<<\n" + text[:CTX_MAX] + "\n>>>")
    parts.append("پرسش کاربر:\n" + question)
    return "\n\n".join(parts)


def _chat_cmd(query_file: str, session: str | None) -> list[str]:
    cmd = [HERMES, "chat", "--oneshot", "-Q", "-t", "web", "--source", "cli", "--ignore-rules"]
    if session:
        cmd += ["--resume", session]
    return cmd + ["--query-file", query_file]


def run_hermes(prompt: str, session: str | None = None) -> tuple[str, str | None]:
    """One Hermes turn. Answer on stdout, session id on stderr (may be absent)."""
    fd, path = tempfile.mkstemp(prefix="hermes-ask-", suffix=".txt")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(prompt)
        proc = subprocess.run(_chat_cmd(path, session), capture_output=True, text=True, timeout=TIMEOUT)
        if proc.returncode != 0 and session:
            # A stale/quiet "session not found" must not cost the user their question.
            proc = subprocess.run(_chat_cmd(path, None), capture_output=True, text=True, timeout=TIMEOUT)
        found = SESSION_RE.search(proc.stderr or "")
        answer = (proc.stdout or "").strip()
        if proc.returncode != 0 and not answer:
            answer = "هرمس پاسخ نداد: " + ((proc.stderr or "").strip().splitlines() or ["?"])[-1]
        return answer, (found.group(1) if found else session)
    except subprocess.TimeoutExpired:
        return "پاسخ در مهلت %d ثانیه نیامد." % TIMEOUT, session
    finally:
        os.unlink(path)


class Handler(BaseHTTPRequestHandler):
    server_version = "HermesAsk/1.0"

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin.startswith("moz-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _origin_ok(self) -> bool:
        # Any http(s) origin is a page in the browser and must not reach the agent.
        # Requests with no Origin are local processes (curl, tests).
        origin = self.headers.get("Origin", "")
        return origin == "" or origin.startswith("moz-extension://")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/actions":
            return self._json(200, load_actions())
        if path != "/health":
            return self._json(404, {"error": "not_found"})
        self._json(200, {"ok": True, "hermes_bin": os.path.exists(HERMES)})

    def do_PUT(self):  # noqa: N802
        if self.path.split("?")[0] != "/actions":
            return self._json(404, {"error": "not_found"})
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden_origin"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad_json"})
        self._json(200, save_actions(payload))

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/ask":
            return self._json(404, {"error": "not_found"})
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden_origin"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad_json"})
        question = (payload.get("question") or "").strip()
        if not question:
            return self._json(400, {"error": "empty_question"})
        answer, session = run_hermes(build_prompt(payload), payload.get("session") or None)
        self._json(200, {"answer": answer, "session": session})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def selftest() -> None:
    base = {"question": "این صفحه درباره چیست؟", "page": {"url": "https://e.x/a", "title": "T"}}
    p = build_prompt({**base, "selection": "  متن انتخاب  ", "page": {**base["page"], "text": "کل صفحه"}})
    assert "متن انتخاب" in p and "کل صفحه" not in p and "این صفحه درباره چیست؟" in p, p
    p = build_prompt({**base, "selection": "   ", "page": {**base["page"], "text": "کل صفحه"}})
    assert "کل صفحه" in p and "انتخاب کرده" not in p, p
    assert len(build_prompt({**base, "page": {**base["page"], "text": "x" * 99999}})) < CTX_MAX + 2000
    assert len(build_prompt({**base, "selection": "x" * 99999})) < SEL_MAX + 2000
    # An action's payload: one message wins over the selection/page text.
    p = build_prompt({**base, "selection": "sel-1", "text": "msg-1", "page": {**base["page"], "text": "page-1"}})
    assert "msg-1" in p and "sel-1" not in p and "page-1" not in p, p
    # A chat action sends the whole conversation and drops the page header entirely.
    p = build_prompt({**base, "text": "msg-1", "transcript": "chat-1", "page": {**base["page"], "text": "page-1"}})
    assert "chat-1" in p and "msg-1" not in p and "نشانی:" not in p, p
    assert len(build_prompt({**base, "transcript": "x" * 99999})) < TRANSCRIPT_MAX + 2000
    assert _chat_cmd("f", None)[-2:] == ["--query-file", "f"]
    assert _chat_cmd("f", "abc")[-4:] == ["--resume", "abc", "--query-file", "f"]

    # Actions: defaults materialise on first read, junk is dropped, empty prompts are not stored.
    global ACTIONS_PATH
    ACTIONS_PATH = Path(tempfile.mkdtemp(prefix="hermes-ask-actions-")) / "actions.json"
    first = load_actions()
    assert first["message"] and first["chat"] and ACTIONS_PATH.is_file()
    saved = save_actions({
        "message": [{"label": "ک", "prompt": " پرو "}, {"label": "بی‌متن", "prompt": "  "}, "junk"],
        "chat": [{"prompt": "فقط پرامپت"}],
    })
    assert saved["message"] == [{"label": "ک", "prompt": "پرو"}], saved
    assert saved["chat"] == [{"label": "فقط پرامپت", "prompt": "فقط پرامپت"}], saved
    assert load_actions() == saved
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"hermes-ask bridge on http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
