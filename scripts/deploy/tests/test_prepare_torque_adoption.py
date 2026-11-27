from __future__ import annotations

import json
import unittest

from scripts.deploy import prepare_torque_adoption as mod

BLOCK = '''before = 1
TORQUE_ADOPTION = TorqueAdoption(
    source_sha="%s",
    index_digest="sha256:%s",
    arm64_digest="sha256:%s",
    armv7_digest="sha256:%s",
    origin_workflow=".github/workflows/ci.yml",
    origin_run_id=1,
    origin_job_id=2,
)
after = 2
'''
OLD = BLOCK % ("a" * 40, "1" * 64, "2" * 64, "3" * 64)
NEW_VALUES = {
    "source_sha": "b" * 40,
    "index_digest": "sha256:" + "4" * 64,
    "arm64_digest": "sha256:" + "5" * 64,
    "armv7_digest": "sha256:" + "6" * 64,
    "origin_run_id": 11,
    "origin_job_id": 22,
}


class PrepareTorqueAdoptionTest(unittest.TestCase):
    def test_rewrite_block_changes_only_six_values(self):
        new = mod.rewrite_block(OLD, NEW_VALUES)
        expected = (BLOCK % ("b" * 40, "4" * 64, "5" * 64, "6" * 64)).replace(
            "origin_run_id=1,", "origin_run_id=11,"
        ).replace("origin_job_id=2,", "origin_job_id=22,")
        self.assertEqual(new, expected)
        self.assertEqual(mod.adopted_sha(new), "b" * 40)

    def test_rewrite_block_fails_when_missing_or_duplicated(self):
        with self.assertRaises(mod.PrepareError):
            mod.rewrite_block("x = 1\n", NEW_VALUES)
        with self.assertRaises(mod.PrepareError):
            mod.rewrite_block(OLD + OLD, NEW_VALUES)

    def test_pick_platform_digests_ignores_unknown(self):
        manifests = [
            manifest(D1, "linux", "arm64"),
            manifest(D2, "linux", "arm", "v7"),
            manifest(D3, "unknown", "unknown"),
            manifest(D3, "linux", "arm64", "v8"),
        ]
        self.assertEqual(mod.pick_platform_digests(index(manifests)), (D1, D2))

    def test_pick_platform_digests_fails_when_platform_missing(self):
        with self.assertRaises(mod.PrepareError):
            mod.pick_platform_digests(index([manifest(D1, "linux", "arm64"), manifest(D3, "unknown", "unknown")]))

    def test_select_blocked_prs(self):
        prs = [pr(1), pr(2, conclusion="SUCCESS"), pr(3, cross=True), pr(4)]
        self.assertEqual(mod.select_blocked_prs(prs, lambda head: head == "h4"), [1])

    def test_select_job_states(self):
        name = mod.JOB_NAME
        with self.assertRaises(mod.PrepareError) as missing:
            mod.select_job([{"name": "other"}])
        self.assertEqual(missing.exception.code, 4)
        self.assertIn("not published", str(missing.exception))
        with self.assertRaises(mod.PrepareError) as running:
            mod.select_job([{"name": name, "status": "in_progress"}])
        self.assertEqual(running.exception.code, 4)
        with self.assertRaises(mod.PrepareError) as failed:
            mod.select_job([{"name": name, "status": "completed", "conclusion": "failure"}])
        self.assertEqual(failed.exception.code, 5)
        ok = {"name": name, "status": "completed", "conclusion": "success", "id": 7}
        self.assertIs(mod.select_job([ok]), ok)


D1, D2, D3 = ("sha256:" + c * 64 for c in "abc")


def index(manifests):
    return json.dumps({"manifests": manifests}).encode()


def manifest(digest, os_, arch, variant=None):
    platform = {"os": os_, "architecture": arch}
    if variant:
        platform["variant"] = variant
    return {"digest": digest, "platform": platform}


def pr(number, conclusion="FAILURE", cross=False, head="h"):
    return {
        "number": number,
        "headRefOid": head + str(number),
        "isCrossRepository": cross,
        "statusCheckRollup": [{"name": mod.CHECK_NAME, "conclusion": conclusion}],
    }


if __name__ == "__main__":
    unittest.main()
