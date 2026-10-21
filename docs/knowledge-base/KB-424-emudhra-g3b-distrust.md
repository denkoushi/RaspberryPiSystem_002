# KB-424: eMudhra G3B intermediate distrust on Raspberry Pi hosts

- Status: active
- Date: 2026-10-21
- Scope: host OS trust and the inventory user's Chromium NSS database; local implementation, not deployed

## Context

The incident report supplied for this change identifies `EM DV TLS CA - G3B`,
`EM OV TLS CA - G3B`, and `EM EV TLS CA - G3B` (eMudhra BV) as compromised.
The reported Pi5 baseline accepted the DV/OV/EV test sites under
`we-have-a-problem.com`. Their reported chain terminates at
`emSign ECC Root CA - G3`.

## Fix

- OS: deselect only `mozilla/emSign_ECC_Root_CA_-_G3.crt` in
  `/etc/ca-certificates.conf` and run `update-ca-certificates` only on change.
  Missing files/selection lines are skipped. This blocks chains anchored at
  that root, including legitimate certificates using it; it is broader than
  the three intermediates. Other roots and the Pi5 local CA at
  `/usr/local/share/ca-certificates/raspi-system-local-ca.crt` are preserved.
- Chromium: install `libnss3-tools`, initialize a missing `~/.pki/nssdb` as
  the session user, and import the three pinned PEMs with `p,p,p` (explicit
  distrust). Check `certutil -L` first; a nickname with different trust flags
  is reimported. The source certificates' DER SHA-256 fingerprints are asserted
  before changing either trust layer. They are stored outside OS trust-anchor
  directories. See [Chromium NSS management](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/cert_management.md)
  and [NSS trust attributes](https://nss-crypto.org/reference/security/nss/legacy/tools/nss_tools_certutil/index.html).

The managed NSS account is `ansible_user`, resolved through `getent passwd`:
Pi5 `denkon5sd02`; Pi4 `tools03`, `tools04`, `raspi4-fjv60-80`,
`raspi4-kensaku-stonebase01`, `raspi4-sessaku-01`, `raspi4-assembly-01`,
`raspi4-kensaku-02`, `raspi4-assembly-02`; signage `signageras3`.
The kiosk unit uses this account. Signage runtime configuration uses it too
(current signage-lite displays images, but its desktop account is covered).
The server role defines no host Chromium service; its inventory operator
account is covered. Additional manually created browser users are not inferred.

Docker containers, including the API Node runtime and containerized Chromium,
are **not covered**. They have separate trust stores. No container/image changes
are part of this mitigation.

## Deployment Path

`scripts/update-all-clients.sh` delegates to `standard-ansible-release.py`, which
selects `deploy-release-standard.yml` with `pi5`, `pi4`, and `pi3` tags.
Those plays use artifact release roles directly: they do not run `common/main.yml`
and do not choose `terminal_release_mode=full` or `release-only`.
Each play therefore imports `common/tasks/distrusted-intermediates.yml` in its
pre-tasks, inheriting its profile tag and serial host selection. The same file
is imported without a mode gate from `common/main.yml` for provisioning callers.
Certificate policy is host state and is not undone by an application rollback.

## Validation And Prevention

- `python3 -m unittest discover -s scripts/deploy/tests -p 'test_distrusted_intermediates.py' -v`:
  six focused tests cover actual PEM fingerprints, mismatch rejection, real
  Ansible `lineinfile` behavior (absent/already disabled/other roots/local CA),
  NSS ownership/init guards/trust flags, and all three standard profile imports.
- Syntax-check `deploy-release-standard.yml` and `zero2w-edge-setup.yml` with a
  temporary config and synthetic inventory, avoiding production vault files.
- Tests are discovered by the existing `scripts/ci/run-deploy-contracts-local.sh`.

## Rollback

Retire/revert this policy before a subsequent deploy, otherwise it reconverges.
Remove only the leading `!` from the emSign ECC G3 line in
`/etc/ca-certificates.conf`, then run `sudo update-ca-certificates`.
For each managed desktop user, execute the following as that user:

```sh
for kind in DV OV EV; do
  certutil -D -d "sql:$HOME/.pki/nssdb" -n "EM $kind TLS CA - G3B"
done
```

Do not delete the NSS database or the Pi5 local CA. Restart Chromium after
applying or rolling back trust policy before checking browser behavior.

## Open Items

Fleet deployment and live curl/Chromium verification remain unperformed.
After deployment, verify DV/OV/EV rejection and continued Pi5 local-CA access
on each host; check NSS using the session user's account. Docker/API coverage
requires separate work.

## References

- [Dedicated host tasks](../../infrastructure/ansible/roles/common/tasks/distrusted-intermediates.yml)
- [Standard rolling playbook](../../infrastructure/ansible/playbooks/deploy-release-standard.yml)
- [Local CA preparation](../../infrastructure/ansible/playbooks/prepare-client-local-ca-trust.yml)
- [Focused regression tests](../../scripts/deploy/tests/test_distrusted_intermediates.py)
