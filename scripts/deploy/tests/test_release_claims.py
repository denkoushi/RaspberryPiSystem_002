import unittest


from scripts.deploy.rolling_release.release_claims import (
    ClaimAuthority,
    ClaimKind,
    ClaimState,
    IdentityDomain,
    ReleaseClaim,
    ReleaseClaimError,
    project_legacy_host_claims,
    release_claims_for_host,
    validate_release_claims,
)


SHA_A = "a" * 40
SHA_B = "b" * 40
DIGEST_A = "sha256:" + "a" * 64
RUN_ID = "20260721-120000-a1b2c3"
VERIFICATION_ID = "c" * 32
OBSERVED_AT = "2026-07-21T12:00:00Z"


def claim_record(**overrides):
    record = {
        "expectedIdentity": SHA_A,
        "observedIdentity": SHA_A,
        "authority": ClaimAuthority.TERMINAL_REPOSITORY_PROBE.value,
        "verificationId": None,
        "state": ClaimState.VERIFIED.value,
        "observedAt": OBSERVED_AT,
        "lastRunId": RUN_ID,
    }
    record.update(overrides)
    return record


class ReleaseClaimTest(unittest.TestCase):
    def test_closed_kind_domain_authority_and_state_sets_are_stable(self):
        self.assertEqual(
            {kind.value for kind in ClaimKind},
            {
                "controlPlaneApi",
                "controlPlaneWeb",
                "terminalRepository",
                "localArtifact",
                "runtime",
            },
        )
        self.assertEqual(
            {domain.value for domain in IdentityDomain}, {"gitSha", "sha256"}
        )
        self.assertEqual(
            {state.value for state in ClaimState}, {"unknown", "verified"}
        )

    def test_record_round_trip_preserves_the_exact_public_shape(self):
        source = claim_record()
        claim = ReleaseClaim.from_record(ClaimKind.TERMINAL_REPOSITORY, source)

        self.assertEqual(claim.to_record(), source)
        self.assertEqual(claim.identity_domain, IdentityDomain.GIT_SHA)
        self.assertIsNot(claim.to_record(), source)

    def test_unknown_keys_and_unknown_claim_kinds_fail_closed(self):
        with self.assertRaisesRegex(ReleaseClaimError, "fields"):
            ReleaseClaim.from_record(
                ClaimKind.TERMINAL_REPOSITORY,
                {**claim_record(), "unexpected": True},
            )
        with self.assertRaisesRegex(ReleaseClaimError, "claim kind"):
            validate_release_claims({"browserSha": claim_record()})

    def test_identity_domains_and_authority_kind_pairs_are_strict(self):
        invalid = (
            (ClaimKind.TERMINAL_REPOSITORY, claim_record(expectedIdentity="A" * 40)),
            (ClaimKind.LOCAL_ARTIFACT, claim_record()),
            (
                ClaimKind.CONTROL_PLANE_WEB,
                claim_record(authority=ClaimAuthority.PI5_API_IMAGE.value),
            ),
        )
        for kind, record in invalid:
            with self.subTest(kind=kind, record=record), self.assertRaises(
                ReleaseClaimError
            ):
                ReleaseClaim.from_record(kind, record)

        artifact = ReleaseClaim.from_record(
            ClaimKind.LOCAL_ARTIFACT,
            claim_record(
                expectedIdentity=DIGEST_A,
                observedIdentity=DIGEST_A,
                authority=ClaimAuthority.LOCAL_RUNNER_READY.value,
                verificationId=VERIFICATION_ID,
            ),
        )
        self.assertEqual(artifact.identity_domain, IdentityDomain.SHA256)

    def test_ack_observations_require_exact_verification_ids(self):
        base = claim_record(
            authority=ClaimAuthority.SIGNAGE_READY.value,
            verificationId=VERIFICATION_ID,
        )
        ReleaseClaim.from_record(ClaimKind.TERMINAL_REPOSITORY, base)

        for verification_id in (None, "C" * 32, "c" * 31):
            with self.subTest(verification_id=verification_id), self.assertRaisesRegex(
                ReleaseClaimError, "verificationId"
            ):
                ReleaseClaim.from_record(
                    ClaimKind.TERMINAL_REPOSITORY,
                    {**base, "verificationId": verification_id},
                )

        pending = {
            **base,
            "observedIdentity": None,
            "observedAt": None,
            "verificationId": None,
            "state": "unknown",
        }
        ReleaseClaim.from_record(ClaimKind.TERMINAL_REPOSITORY, pending)

    def test_non_ack_authority_rejects_a_verification_id(self):
        with self.assertRaisesRegex(ReleaseClaimError, "non-ACK"):
            ReleaseClaim.from_record(
                ClaimKind.TERMINAL_REPOSITORY,
                claim_record(verificationId=VERIFICATION_ID),
            )

    def test_verified_claim_requires_matching_observation_time_and_run(self):
        invalid = (
            claim_record(observedIdentity=SHA_B),
            claim_record(observedAt="2026-07-21T21:00:00+09:00"),
            claim_record(observedAt=None),
            claim_record(lastRunId=None),
            claim_record(lastRunId="../run"),
        )
        for record in invalid:
            with self.subTest(record=record), self.assertRaises(ReleaseClaimError):
                ReleaseClaim.from_record(ClaimKind.TERMINAL_REPOSITORY, record)

        mismatch = claim_record(
            observedIdentity=SHA_B,
            state="unknown",
        )
        self.assertEqual(
            ReleaseClaim.from_record(
                ClaimKind.TERMINAL_REPOSITORY, mismatch
            ).observed_identity,
            SHA_B,
        )

    def test_claim_object_is_bounded_and_returns_a_private_copy(self):
        source = {"terminalRepository": claim_record()}
        validated = validate_release_claims(source)
        source["terminalRepository"]["state"] = "unknown"

        self.assertEqual(validated["terminalRepository"]["state"], "verified")
        with self.assertRaisesRegex(ReleaseClaimError, "closed claim-kind bound"):
            validate_release_claims(
                {
                    **{kind.value: claim_record() for kind in ClaimKind},
                    "extra": claim_record(),
                }
            )

    def test_legacy_terminal_projection_never_infers_browser_web(self):
        record = {
            "role": "kiosk",
            "desiredSha": SHA_A,
            "currentSha": SHA_A,
            "evidence": "verified",
            "verifiedAt": OBSERVED_AT,
            "lastRunId": RUN_ID,
        }

        claims = project_legacy_host_claims(record)

        self.assertEqual(set(claims), {"terminalRepository"})
        self.assertNotIn("controlPlaneWeb", claims)
        self.assertEqual(claims["terminalRepository"]["state"], "verified")

    def test_legacy_pi5_projection_is_limited_to_its_two_images(self):
        record = {
            "role": "server",
            "desiredSha": SHA_A,
            "currentSha": SHA_A,
            "evidence": "verified",
            "verifiedAt": OBSERVED_AT,
            "lastRunId": RUN_ID,
            "activeSlot": "blue",
            "apiImage": f"api:{SHA_A}-aaaaaaaaaaaa",
            "webImage": f"web:{SHA_A}-bbbbbbbbbbbb",
            "configDigest": DIGEST_A,
            "migrationDigest": DIGEST_A,
        }

        claims = project_legacy_host_claims(record)

        self.assertEqual(set(claims), {"controlPlaneApi", "controlPlaneWeb"})
        self.assertEqual(
            claims["controlPlaneWeb"]["authority"], "pi5-web-image"
        )

        self.assertEqual(
            project_legacy_host_claims({**record, "webImage": "web:latest"}),
            {},
        )

    def test_legacy_rollback_drift_retains_observation_without_promoting_it(self):
        record = {
            "role": "signage",
            "desiredSha": SHA_B,
            "currentSha": SHA_A,
            "evidence": "verified",
            "verifiedAt": OBSERVED_AT,
            "lastRunId": RUN_ID,
        }

        claim = project_legacy_host_claims(record)["terminalRepository"]

        self.assertEqual(claim["expectedIdentity"], SHA_B)
        self.assertEqual(claim["observedIdentity"], SHA_A)
        self.assertEqual(claim["state"], "unknown")

    def test_unknown_legacy_evidence_projects_nothing(self):
        self.assertEqual(
            project_legacy_host_claims(
                {
                    "role": "kiosk",
                    "desiredSha": SHA_A,
                    "currentSha": None,
                    "evidence": "unknown",
                    "verifiedAt": None,
                    "lastRunId": RUN_ID,
                }
            ),
            {},
        )

    def test_explicit_claims_take_precedence_over_legacy_projection(self):
        explicit = {"terminalRepository": claim_record()}
        record = {
            "role": "kiosk",
            "desiredSha": SHA_A,
            "currentSha": SHA_A,
            "evidence": "verified",
            "verifiedAt": OBSERVED_AT,
            "lastRunId": RUN_ID,
            "releaseClaims": explicit,
        }

        self.assertEqual(release_claims_for_host(record), explicit)

        with self.assertRaisesRegex(ReleaseClaimError, "legacy desiredSha"):
            release_claims_for_host(
                {
                    **record,
                    "releaseClaims": {
                        "terminalRepository": claim_record(
                            expectedIdentity=SHA_B,
                            observedIdentity=SHA_B,
                            state="unknown",
                        )
                    },
                }
            )

    def test_explicit_rollback_claim_must_equal_the_sealed_previous_sha(self):
        rollback = {
            "role": "signage",
            "desiredSha": SHA_B,
            "currentSha": SHA_A,
            "previousSha": SHA_A,
            "evidence": "verified",
            "verifiedAt": OBSERVED_AT,
            "lastRunId": RUN_ID,
            "releaseClaims": {"terminalRepository": claim_record()},
        }

        self.assertEqual(
            release_claims_for_host(rollback), rollback["releaseClaims"]
        )

        with self.assertRaisesRegex(ReleaseClaimError, "legacy desiredSha"):
            release_claims_for_host({**rollback, "previousSha": SHA_B})

    def test_legacy_projection_requires_an_explicit_host_role(self):
        self.assertEqual(
            project_legacy_host_claims(
                {
                    "desiredSha": SHA_A,
                    "currentSha": SHA_A,
                    "evidence": "verified",
                    "verifiedAt": OBSERVED_AT,
                    "lastRunId": RUN_ID,
                }
            ),
            {},
        )


if __name__ == "__main__":
    unittest.main()
