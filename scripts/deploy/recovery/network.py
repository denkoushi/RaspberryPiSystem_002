"""Network-policy adapters for Pi4 bare-metal recovery."""

from __future__ import annotations

import ipaddress
from typing import Protocol

from .inventory import ResolvedRecoveryContract


RFC1918_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
)


class RecoveryNetworkError(RuntimeError):
    """The selected recovery network cannot satisfy its safety contract."""


class RecoveryNetworkProvider(Protocol):
    """Validate and persist one recovery transport without doing I/O."""

    def validate_contract(self, contract: ResolvedRecoveryContract) -> None:
        """Reject an incomplete or unsupported resolved network contract."""

    def validate_bootstrap(
        self, bootstrap_host: str, contract: ResolvedRecoveryContract
    ) -> str:
        """Return the canonical bootstrap endpoint or reject it."""

    def read_result(
        self,
        payload: object,
        *,
        target_host: str,
        release_sha: str,
        expected_endpoint: str,
    ) -> str:
        """Validate Ansible's observed endpoint result."""

    def runtime_host_vars(self, endpoint: str) -> dict[str, object]:
        """Return non-secret Ansible host variables for the selected transport."""

    def is_managed_endpoint(self, value: str) -> bool:
        """Return whether a saved endpoint belongs to this provider."""


def _rfc1918_ipv4(value: str, *, field: str) -> ipaddress.IPv4Address:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as error:
        raise RecoveryNetworkError(
            f'{field} must be a literal RFC1918 IPv4 address: {value!r}'
        ) from error
    if not isinstance(address, ipaddress.IPv4Address) or not any(
        address in network for network in RFC1918_NETWORKS
    ):
        raise RecoveryNetworkError(
            f'{field} must be a literal RFC1918 IPv4 address: {value!r}'
        )
    return address


class LanRecoveryNetworkProvider:
    """Use inventory-declared, Pi5-routable private LAN addresses."""

    mode = 'lan'

    def validate_contract(self, contract: ResolvedRecoveryContract) -> None:
        network = contract.recovery_network
        if network.mode != self.mode:
            raise RecoveryNetworkError('recovery network mode is unsupported')
        if not network.configured:
            raise RecoveryNetworkError(
                'LAN recovery is not configured for this host; declare both target and Pi5 LAN endpoints'
            )
        target = _rfc1918_ipv4(
            network.target_endpoint, field='recovery target endpoint'
        )
        server = _rfc1918_ipv4(
            network.server_endpoint, field='recovery Pi5 endpoint'
        )
        if target == server:
            raise RecoveryNetworkError(
                'recovery target endpoint must differ from the Pi5 LAN endpoint'
            )

    def validate_bootstrap(
        self, bootstrap_host: str, contract: ResolvedRecoveryContract
    ) -> str:
        self.validate_contract(contract)
        bootstrap = _rfc1918_ipv4(bootstrap_host, field='bootstrap host')
        expected = _rfc1918_ipv4(
            contract.recovery_network.target_endpoint,
            field='recovery target endpoint',
        )
        if bootstrap != expected:
            raise RecoveryNetworkError(
                'bootstrap host must equal the inventory-declared LAN recovery endpoint; '
                'verify the DHCP reservation or update the approved inventory value'
            )
        return str(bootstrap)

    def read_result(
        self,
        payload: object,
        *,
        target_host: str,
        release_sha: str,
        expected_endpoint: str,
    ) -> str:
        if not isinstance(payload, dict):
            raise RecoveryNetworkError('Ansible recovery result is not an object')
        address = payload.get('lanIpv4')
        if (
            not isinstance(address, str)
            or payload.get('target') != target_host
            or payload.get('releaseSha') != release_sha
        ):
            raise RecoveryNetworkError(
                'Ansible recovery result does not prove the expected LAN endpoint'
            )
        observed = _rfc1918_ipv4(address, field='observed recovery endpoint')
        expected = _rfc1918_ipv4(
            expected_endpoint, field='expected recovery endpoint'
        )
        if observed != expected:
            raise RecoveryNetworkError(
                'Ansible recovery result observed a different LAN endpoint'
            )
        return str(observed)

    def runtime_host_vars(self, endpoint: str) -> dict[str, object]:
        managed = _rfc1918_ipv4(endpoint, field='runtime recovery endpoint')
        return {
            'ansible_host': str(managed),
            'network_mode': 'local',
            'tailscale_enabled': False,
        }

    def is_managed_endpoint(self, value: str) -> bool:
        try:
            _rfc1918_ipv4(value, field='runtime recovery endpoint')
        except RecoveryNetworkError:
            return False
        return True
