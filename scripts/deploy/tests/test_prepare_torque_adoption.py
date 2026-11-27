from __future__ import annotations

import pytest

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


def test_rewrite_block_changes_only_six_values():
    new = mod.rewrite_block(OLD, NEW_VALUES)
    expected = (BLOCK % ("b" * 40, "4" * 64, "5" * 64, "6" * 64)).replace(
        "origin_run_id=1,", "origin_run_id=11,"
    ).replace("origin_job_id=2,", "origin_job_id=22,")
    assert new == expected
    assert mod.adopted_sha(new) == "b" * 40


def test_rewrite_block_fails_when_missing_or_duplicated():
    with pytest.raises(mod.PrepareError):
        mod.rewrite_block("x = 1\n", NEW_VALUES)
    with pytest.raises(mod.PrepareError):
        mod.rewrite_block(OLD + OLD, NEW_VALUES)


def manifest(digest, os_, arch, variant=None):
    platform = {"os": os_, "architecture": arch}
    if variant:
        platform["variant"] = variant
    return {"digest": digest, "platform": platform}


def test_pick_platform_digests_ignores_unknown():
    manifests = [
        manifest("sha256:a", "linux", "arm64"),
        manifest("sha256:b", "linux", "arm", "v7"),
        manifest("sha256:c", "unknown", "unknown"),
    ]
    assert mod.pick_platform_digests(manifests) == ("sha256:a", "sha256:b")


def test_pick_platform_digests_fails_when_platform_missing():
    with pytest.raises(mod.PrepareError):
        mod.pick_platform_digests(
            [manifest("sha256:a", "linux", "arm64"), manifest("sha256:c", "unknown", "unknown")]
        )


def pr(number, conclusion="FAILURE", cross=False, head="h"):
    return {
        "number": number,
        "headRefOid": head + str(number),
        "isCrossRepository": cross,
        "statusCheckRollup": [{"name": mod.CHECK_NAME, "conclusion": conclusion}],
    }


def test_select_blocked_prs():
    prs = [
        pr(1),
        pr(2, conclusion="SUCCESS"),
        pr(3, cross=True),
        pr(4),
    ]
    selected = mod.select_blocked_prs(prs, lambda head: head == "h4")
    assert selected == [1]


def test_select_job_states():
    name = mod.JOB_NAME
    with pytest.raises(mod.PrepareError) as missing:
        mod.select_job([{"name": "other"}])
    assert missing.value.code == 4 and "not published" in str(missing.value)
    with pytest.raises(mod.PrepareError) as running:
        mod.select_job([{"name": name, "status": "in_progress"}])
    assert running.value.code == 4
    with pytest.raises(mod.PrepareError) as failed:
        mod.select_job([{"name": name, "status": "completed", "conclusion": "failure"}])
    assert failed.value.code == 5
    ok = {"name": name, "status": "completed", "conclusion": "success", "id": 7}
    assert mod.select_job([ok]) is ok
