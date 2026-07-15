#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate_required_results import JobResult, parse_job, validation_errors  # noqa: E402


class ValidateRequiredResultsTests(unittest.TestCase):
    def test_selected_success_and_unselected_skip_are_accepted(self) -> None:
        errors = validation_errors(
            "success",
            [
                JobResult("api", "true", "success"),
                JobResult("web", "false", "skipped"),
            ],
        )
        self.assertEqual(errors, [])

    def test_failure_cancel_and_unexpected_execution_fail_closed(self) -> None:
        for job in (
            JobResult("api", "true", "failure"),
            JobResult("api", "true", "cancelled"),
            JobResult("web", "false", "success"),
            JobResult("web", "", "skipped"),
        ):
            with self.subTest(job=job):
                self.assertTrue(validation_errors("success", [job]))

    def test_classifier_failure_is_rejected(self) -> None:
        self.assertEqual(
            validation_errors(
                "failure", [JobResult("api", "false", "skipped")]
            ),
            ["change-classification=failure"],
        )

    def test_cli_value_parser(self) -> None:
        self.assertEqual(
            parse_job("deploy-contract=true:success"),
            JobResult("deploy-contract", "true", "success"),
        )


if __name__ == "__main__":
    unittest.main()
