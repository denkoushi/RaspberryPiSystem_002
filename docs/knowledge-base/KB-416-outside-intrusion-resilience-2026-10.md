# KB-416: Lowering the risk of an outside intrusion that stops operations (2026-10)

- Status: `active`
- Scope: Pi5 server host (OS packages, backup lanes, monitoring), Pi4 kiosks and the Pi3 signage device (OS packages), release tooling for host configuration

## Context

After the access-control fixes and the device credential rotation of 2026-10-06 ([KB-415](./KB-415-ai-security-scan-2026-10.md)), the system owner set the goal as: reduce, to a realistic level, the risk that someone breaks in from outside and leaves the system unable to operate. On 2026-10-07 the controls that decide that outcome were checked on the real devices, read-only: what is reachable from outside, whether a backup can actually be restored, whether failures are noticed, and whether security updates are applied.

This repository is public. This record names areas and outcomes and leaves out anything that would help an attacker with an item that is still open.

## Symptoms Or Trigger

No incident. The owner asked whether the system is exposed to the common pattern of intrusions through unapplied updates, and whether anything keeps the devices current.

## Investigation

What was found on the devices (all ten: Pi5, seven Pi4, Pi3; read-only commands run by the owner):

- Exposure matched the design. The Pi5 firewall was active with the documented rules, SSH accepted keys only, the intrusion-ban service and the 15-minute security monitor were running, and no tunnel or public sharing feature was in use.
- The nightly full snapshot to off-site storage had succeeded on each of the last four nights. An isolated restore check of the newest snapshot passed on 2026-10-07 (11:21 to 11:32 JST, about 2.9 GB, stage `restore_check_complete`); the size matches the sum of the application data directories plus the database dump. The last recorded restore attempt before that, in January, had not completed.
- No device applied OS updates automatically: `unattended-upgrades` was not installed and `APT::Periodic` was unset everywhere. Package lists were fresh and nothing was held or pinned; upgrades were simply never applied. The Pi5 had 245 pending packages, including a kernel series change.
- The monthly and quarterly backup verification runs had failed on 2026-10-04. They had correctly found that some targets of the daily backup lane had not been backed up for about six weeks. Nothing alerted, so nobody knew for three days. The same data is inside the nightly snapshot.
- `logrotate.service` had been failing daily because one of our files repeated log paths that packages already rotate.
- The security monitor sent false "unexpected port" alerts for short-lived outbound UDP sockets such as the time-sync client.

Two mistakes in my own checks are worth recording because they produced wrong answers that looked right:

- A package count of "0 upgradable" was reported for nine devices. The check matched English text, and those devices print Japanese. Only the one English-locale device showed its real count. Any check that parses tool output must force the locale (`LC_ALL=C`, and through `sudo` use `sudo env LC_ALL=C ...` because `sudo` resets the environment).
- "The verification timers are running" was reported from the timer list alone. A timer that fires is not a job that succeeds; `systemctl --failed` and the unit result must be read as well.

## Root Cause

The controls had been built one at a time and each was correct, but nothing closed the loop: updates were available and not applied, verification ran and its failure went nowhere, and the off-site copies are all reachable with credentials that live on the server they protect.

## Fix

Done on 2026-10-07:

| Change | PR | Commit on `main` | In production |
| --- | --- | --- | --- |
| Pending OS packages applied on the Pi5 by hand: 231 upgraded, kernel, boot firmware, bootloader, Docker and Tailscale kept back, no reboot, application up throughout (12:00 to 12:11 JST) | none | none | yes |
| Scheduled backup failure queues an ops alert; the nightly snapshot unit gets an on-failure alert unit | #1787 | `aa629bbe` | API part released (run `20261007-032350-30ac43`); the unit files need the dedicated snapshot playbook |
| Security monitor no longer alerts on short-lived outbound UDP sockets | #1786 | `ee2591e7` | needs the server role |
| Backup verification failure queues an ops alert; duplicate logrotate entries removed | #1792 | `d2e453fb` | needs the server role |
| The standard Pi5 release installs `unattended-upgrades`: Debian security origin only, no automatic reboot, Docker, Tailscale, kernel, firmware and Chromium excluded | #1788 | `69d0199c` | released (run `20261007-034510-c5ed02`); dry run shows the single allowed origin, the exclusion list and nothing pending; first automatic run 2026-10-08 06:03 JST |

## Prevention

- Force the locale in every check that parses command output, and read results, not schedules.
- A job that verifies something must alert when it fails; otherwise it only produces a log.
- Host configuration that matters for safety should be converged by the standard release where the existing role split allows it, so it cannot drift. What only the server role delivers must be applied on purpose after each change to it.
- Applying a large backlog of OS packages: keep back the kernel, boot firmware, the container runtime and the remote-access agent unless a reboot is planned with someone at the device; copy the boot partition first; expect passwordless `sudo` to be briefly unavailable while its packages are replaced.

## Validation

- Restore check and package run: times and results above; after the package run the listening sockets, firewall, SSH settings, masked services and container count were unchanged, the API health check returned 200, and only the two initramfs files for the running kernel differed on the boot partition.
- Releases after the package run: `20261007-032350-30ac43` (`failed=0`) and `20261007-034510-c5ed02` (`failed=0 rescued=0`), all four entry URLs 200.
- Local test runs before each PR: #1786 14, #1787 18 API and 12 contract, #1788 76, #1792 20 (one skipped).

## Open Items

- An off-site or offline backup copy that cannot be deleted with credentials held on the Pi5. This is the largest remaining gap for the stated goal.
- Kernel, boot firmware, Docker and Tailscale updates on the Pi5 with a planned reboot and someone at the device; the same backlog on the Pi4 kiosks and the Pi3, where the kiosk browser version is being moved deliberately ([KB-413](./KB-413-kiosk-chromium-canary-stonebase01.md)).
- Applying the server role and the snapshot playbook for #1786, #1787 (unit files) and #1792, after a dry run that shows the application environment files are not rewritten.
- A "no successful backup for N hours" alert, because a run that is skipped does not fail; a reboot-required notice; extending automatic security updates to the kiosks.
- The stale targets of the daily backup lane are owned by the session working on that lane.
- Account checks outside the repository (two-factor on the network, storage and mail accounts; removing unused devices from the private network) are with the system owner.

## References

- PRs #1786, #1787, #1788, #1792
- [KB-415](./KB-415-ai-security-scan-2026-10.md), `docs/runbooks/google-drive-disaster-recovery.md`, `docs/plans/security-client-key-rotation-phase-b.md`
