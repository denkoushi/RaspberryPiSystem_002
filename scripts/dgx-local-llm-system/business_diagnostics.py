"""Bounded business failure records without commands or request payloads."""

import json
import os
import re
import sys


def log_business_failure(action, profile_id, generation, error, *, secrets=(), detail=""):
    def clean(value):
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="replace")
        text = str(value or "")
        # Scrub known environment values before truncation, including tokens that
        # might straddle the tail boundary. Never serialize commands or env maps.
        values = set(secrets) | {v for k, v in os.environ.items()
            if len(v) >= 4 and any(word in k.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD"))}
        for secret in sorted(filter(None, values), key=len, reverse=True):
            text = text.replace(secret, "[REDACTED]")
        text = re.sub(r'(?i)(["\']?(?:api[_-]?key|token|secret|password)["\']?\s*:\s*)(?:"[^"\n]*"|[^\s,}]+)', r"\1[REDACTED]", text)
        text = re.sub(r"(?i)bearer\s+[^\s]+", "Bearer [REDACTED]", text)
        text = re.sub(r"\b[A-Za-z_][A-Za-z_0-9]*=(?:\"[^\"]*\"|'[^']*'|[^\s]+)", "[REDACTED assignment]", text)
        return text

    record = {"action": action, "profileId": profile_id, "generation": generation,
              "exceptionType": type(error).__name__,
              "detail": clean(detail)[-500:],
              "stderr": clean(getattr(error, "stderr", None))[-2000:],
              "stdout": clean(getattr(error, "stdout", None))[-2000:]}
    # JSON escaping keeps multiline subprocess output in a single log record.
    while len(json.dumps(record, ensure_ascii=True)) > 2000:
        field = max(("stderr", "stdout"), key=lambda key: len(record[key]))
        if not record[field]:
            break
        record[field] = record[field][max(1, len(record[field]) // 4):]
    print(json.dumps(record, ensure_ascii=True), file=sys.stderr)
