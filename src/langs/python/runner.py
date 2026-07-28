"""
Niral Backend Protocol (NBP) runner — Python.

Executes the <server lang="python"> block of a .niral component and serves
function calls over newline-delimited JSON on stdin/stdout. Python stdlib
only — nothing to install.

  usage: python3 runner.py <server-module.py>

  request:  {"id": 1, "fn": "add_entry", "args": ["hi"], "session": {...}}
  response: {"id": 1, "ok": true, "result": ..., "session": {...}|null}
            {"id": 1, "ok": false, "error": "msg", "errorKind": "unknown_fn"?}

`session` is ambient inside server functions (like the JS runtime):
    session.get("k", default) / session.set("k", v) / session["k"] = v
Mutations are sent back; the Node orchestrator signs the cookie.
"""

import json
import sys


class Session:
    def __init__(self):
        self.data = {}
        self.dirty = False

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value
        self.dirty = True

    def delete(self, key):
        self.data.pop(key, None)
        self.dirty = True

    def clear(self):
        self.data = {}
        self.dirty = True

    def all(self):
        return dict(self.data)

    def __getitem__(self, key):
        return self.data[key]

    def __setitem__(self, key, value):
        self.data[key] = value
        self.dirty = True

    def __contains__(self, key):
        return key in self.data


def _publish(channel, data=None):
    """Ambient publish() — fan out to a live channel (out-of-band NBP line)."""
    sys.stdout.write(json.dumps({"publish": {"channel": str(channel), "data": data}}) + "\n")
    sys.stdout.flush()


def main():
    src_path = sys.argv[1]
    session = Session()
    ns = {
        "session": session,
        "publish": _publish,
        "user": lambda: session.get("user"),
        "__name__": "niral_server",
    }
    with open(src_path, "r", encoding="utf-8") as f:
        code = f.read()
    exec(compile(code, src_path, "exec"), ns)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue

        out = {"id": req.get("id")}
        fn_name = req.get("fn") or ""
        fn = ns.get(fn_name)

        if not callable(fn) or fn_name.startswith("_"):
            out.update(ok=False, error="unknown server function '%s'" % fn_name, errorKind="unknown_fn")
        else:
            session.data = req.get("session") or {}
            session.dirty = False
            try:
                result = fn(*(req.get("args") or []))
                out.update(ok=True, result=result, session=(session.data if session.dirty else None))
            except Exception as e:  # noqa: BLE001 — every error becomes a protocol response
                out.update(ok=False, error=str(e) or type(e).__name__,
                           session=(session.data if session.dirty else None))

        try:
            payload = json.dumps(out)
        except (TypeError, ValueError) as e:
            payload = json.dumps({"id": req.get("id"), "ok": False,
                                  "error": "result is not JSON-serializable: %s" % e})
        sys.stdout.write(payload + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
