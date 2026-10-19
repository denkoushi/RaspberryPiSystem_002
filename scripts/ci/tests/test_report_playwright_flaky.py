from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from scripts.ci import report_playwright_flaky as report

# Shape taken from a real Playwright JSON report where one test passed on retry.
SAMPLE = {
    "suites": [
        {
            "title": "demo.spec.ts",
            "file": "demo.spec.ts",
            "specs": [],
            "suites": [
                {
                    "title": "group",
                    "file": "demo.spec.ts",
                    "specs": [
                        {
                            "title": "flaky one",
                            "file": "demo.spec.ts",
                            "line": 3,
                            "tests": [{"status": "flaky"}],
                        },
                        {
                            "title": "stable one",
                            "file": "demo.spec.ts",
                            "line": 4,
                            "tests": [{"status": "expected"}],
                        },
                    ],
                }
            ],
        }
    ]
}


class ReportPlaywrightFlakyTests(unittest.TestCase):
    def test_only_retried_passes_are_reported(self) -> None:
        self.assertEqual(
            report.flaky_tests(SAMPLE),
            [report.FlakyTest(file="demo.spec.ts", line=3, title="group > flaky one")],
        )

    def test_warning_and_summary_are_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "results.json")
            path.write_text(json.dumps(SAMPLE), encoding="utf-8")
            summary = Path(tmp, "summary.md")
            out = io.StringIO()
            with redirect_stdout(out):
                code = report.main([str(path), "--label", "E2E", "--summary-file", str(summary)])
            self.assertEqual(code, 0)
            self.assertIn("::warning file=e2e/demo.spec.ts,line=3,", out.getvalue())
            self.assertIn("1 flaky test(s) passed only after retry", summary.read_text())

    def test_missing_report_is_not_an_error(self) -> None:
        with redirect_stdout(io.StringIO()):
            self.assertEqual(report.main(["/nonexistent/results.json"]), 0)

    def test_clean_run_summary(self) -> None:
        self.assertIn("no flaky tests", report.summary_markdown("E2E", []))


if __name__ == "__main__":
    unittest.main()
