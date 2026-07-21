"""Safety contract for pinned StoneBase Local SSH host authentication."""
from __future__ import annotations

import base64
import unittest

from scripts.deploy.rolling_release.local_transport_contract import (
    LocalTransportContractError,
    ssh_security_options,
    validate_known_hosts_payload,
)


VALID_KEY = (
    "AAAAC3NzaC1lZDI1NTE5AAAAIFZUFszeD9xbuiKR9+X8lDn/"
    "ZXW1tlLCUvasHb2N7ox+"
)
VALID_RECORD = f"* ssh-ed25519 {VALID_KEY}\n"


class LocalTransportContractTest(unittest.TestCase):
    def test_accepts_one_canonical_wildcard_ed25519_pin(self) -> None:
        self.assertEqual(validate_known_hosts_payload(VALID_RECORD), VALID_RECORD)
        self.assertEqual(validate_known_hosts_payload(VALID_RECORD.encode()), VALID_RECORD)

    def test_rejects_noncanonical_or_extra_records(self) -> None:
        invalid = (
            "",
            f"stonebase ssh-ed25519 {VALID_KEY}\n",
            f"* ssh-rsa {VALID_KEY}\n",
            f"* ssh-ed25519 {VALID_KEY} comment\n",
            f"* ssh-ed25519 {VALID_KEY}\n* ssh-ed25519 {VALID_KEY}\n",
            f"# comment\n* ssh-ed25519 {VALID_KEY}\n",
            f"* ssh-ed25519 {VALID_KEY}\n\n",
            f"* ssh-ed25519 {VALID_KEY}\r\n",
            f"* ssh-ed25519 {VALID_KEY}\x00",
        )
        for value in invalid:
            with self.subTest(value=repr(value)), self.assertRaises(
                LocalTransportContractError
            ):
                validate_known_hosts_payload(value)

    def test_rejects_malformed_key_blob_even_when_base64_is_valid(self) -> None:
        malformed_blobs = (
            b"ssh-ed25519",
            b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x1f" + b"x" * 31,
            b"\x00\x00\x00\x07ssh-rsa" + b"x" * 40,
        )
        for blob in malformed_blobs:
            encoded = base64.b64encode(blob).decode("ascii")
            with self.subTest(blob=blob), self.assertRaises(
                LocalTransportContractError
            ):
                validate_known_hosts_payload(f"* ssh-ed25519 {encoded}\n")

    def test_security_options_are_exact_and_nonambient(self) -> None:
        path = "/run/raspi-release/stonebase-known-hosts"
        self.assertEqual(
            ssh_security_options(path),
            (
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                f"UserKnownHostsFile={path}",
                "-o",
                "GlobalKnownHostsFile=/dev/null",
                "-o",
                "UpdateHostKeys=no",
                "-o",
                "HostKeyAlgorithms=ssh-ed25519",
            ),
        )

    def test_security_options_reject_nonabsolute_or_ambiguous_paths(self) -> None:
        for path in ("relative", "/tmp/../known-hosts", "/tmp//known-hosts", "/tmp/x\x00y"):
            with self.subTest(path=path), self.assertRaises(
                LocalTransportContractError
            ):
                ssh_security_options(path)


if __name__ == "__main__":
    unittest.main()
