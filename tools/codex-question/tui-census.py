"""Inventory the pinned archive without extracting or executing its source."""
import hashlib
import json
import re
import sys
import tarfile

prefix = f"codex-rust-v{sys.argv[2]}/codex-rs/"
files, matches, total = {}, [], 0
try:
    with tarfile.open(sys.argv[1]) as archive:
        for member in archive:
            if not member.name.startswith(prefix + "tui/src/") or not member.name.endswith(".rs"):
                continue
            if not member.isfile() or member.size > 4 * 1024 * 1024 or len(files) >= 4096:
                raise ValueError("source-bound")
            total += member.size
            if total > 32 * 1024 * 1024:
                raise ValueError("source-bound")
            data = archive.extractfile(member).read()
            text = data.decode("utf-8")
            name = member.name.removeprefix(prefix)
            files[name] = text
            for line, value in enumerate(text.splitlines(), 1):
                if "thread_unload_delay_secs" in value:
                    matches.append({"file": name, "line": line, "testOnly": name == "tui/src/app/tests.rs" or name.startswith("tui/src/app/tests/")})
    gated = bool(re.search(r"#\[cfg\(test\)\]\s*mod tests;", files.get("tui/src/app.rs", "")))
    passed = bool(files) and gated and all(m["testOnly"] for m in matches)
    result = {"status": "passed" if passed else "failed", "sourceFiles": len(files), "matches": matches, "testModuleGated": gated, "rule": "literal unload-override callsite census; custom configuration remains possible"}
except (OSError, ValueError, tarfile.TarError, UnicodeError):
    result = {"status": "failed", "reason": "source-census"}
print(json.dumps(result))
sys.exit(0 if result["status"] == "passed" else 1)
