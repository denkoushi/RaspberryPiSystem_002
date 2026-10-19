from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
TRUST = (ANSIBLE / "playbooks/prepare-client-local-ca-trust.yml").read_text()
CERTIFICATE = (
    ANSIBLE / "playbooks/activate-pi5-local-ca-certificate.yml"
).read_text()
VERIFY = (ANSIBLE / "playbooks/verify-client-local-tls.yml").read_text()
INVENTORY = (ANSIBLE / "inventory.yml").read_text()


class LocalTlsRolloutBoundaryTest(unittest.TestCase):
    def test_every_operational_step_is_normal_factory_only_and_approved(self):
        for source in (TRUST, CERTIFICATE, VERIFY):
            self.assertIn("'talkplaza' not in group_names", source)
        self.assertIn("normal_factory_local_ca_trust_approved", TRUST)
        self.assertIn(
            "normal_factory_local_ca_certificate_activation_approved", CERTIFICATE
        )
        self.assertIn("normal_factory_local_tls_verification_approved", VERIFY)
        self.assertIn("hosts: server:clients", TRUST)
        self.assertIn("hosts: server:clients", VERIFY)

    def test_ca_trust_requires_digest_validation_and_restores_on_failure(self):
        self.assertIn("local_ca_certificate_sha256", TRUST)
        self.assertIn("checksum_algorithm: sha256", TRUST)
        self.assertIn("update-ca-certificates", TRUST)
        self.assertIn("Restore the previous CA certificate", TRUST)
        self.assertIn("Remove a newly introduced CA certificate", TRUST)

    def test_certificate_staging_validates_chain_identity_and_key_without_reload(self):
        self.assertIn("- -verify_ip", CERTIFICATE)
        self.assertIn("pi5_leaf_modulus.stdout == pi5_key_modulus.stdout", CERTIFICATE)
        self.assertIn("caddy", CERTIFICATE)
        self.assertIn("validate", CERTIFICATE)
        self.assertIn("Restore the previous Pi5 certificate", CERTIFICATE)
        for forbidden in ("state: restarted", "caddy reload", "docker compose up", "systemctl"):
            self.assertNotIn(forbidden, CERTIFICATE.lower())

    def test_read_only_probe_uses_default_ca_and_hostname_validation(self):
        self.assertIn("ssl.create_default_context()", VERIFY)
        self.assertNotIn("_create_unverified_context", VERIFY)
        self.assertNotIn("CERT_NONE", VERIFY)
        self.assertIn("changed_when: false", VERIFY)

    def test_insecure_clients_are_not_flipped_before_operational_evidence(self):
        self.assertIn('status_agent_tls_skip_verify: "1"', INVENTORY)
        self.assertIn('torque_agent_tls_verify_mode: "insecure"', INVENTORY)


if __name__ == "__main__":
    unittest.main()
