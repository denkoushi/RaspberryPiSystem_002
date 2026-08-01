"""Resolve the secret-free Pi4 recovery contract through Ansible itself."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


RECOVERY_HOST_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,79}$')


class RecoveryInventoryError(RuntimeError):
    """An inventory contract could not be resolved without ambiguity."""


class RecoveryInventoryCommandRunner(Protocol):
    def run(
        self,
        command: list[str],
        *,
        capture: bool = True,
        cwd: Path | None = None,
    ) -> str:
        """Run a controller command."""


@dataclass(frozen=True)
class ResolvedRecoveryTarget:
    host: str
    inventory_endpoint: str
    user: str
    status_agent_client_id: str
    recovery_enabled: bool
    kiosk_managed: bool
    nfc_enabled: bool
    barcode_enabled: bool
    required_secrets_configured: bool


@dataclass(frozen=True)
class ResolvedRecoveryServer:
    host: str
    status_agent_client_id: str


@dataclass(frozen=True)
class RecoveryNetworkReadiness:
    mode: str
    configured: bool
    server_endpoint: str


@dataclass(frozen=True)
class ResolvedRecoveryContract:
    target: ResolvedRecoveryTarget
    server: ResolvedRecoveryServer
    recovery_network: RecoveryNetworkReadiness


class RecoveryInventoryResolver(Protocol):
    def resolve(self, target_name: str) -> ResolvedRecoveryContract:
        """Return Ansible's evaluated, secret-free contract for one host."""


def _object(value: object, *, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise RecoveryInventoryError(f'recovery inventory contract field {field!r} is not an object')
    return value


def _string(values: dict[str, object], key: str, *, field: str | None = None) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RecoveryInventoryError(
            f'recovery inventory contract field {(field or key)!r} is missing'
        )
    return value.strip()


def _optional_string(
    values: dict[str, object], key: str, *, field: str | None = None
) -> str:
    value = values.get(key)
    if not isinstance(value, str):
        raise RecoveryInventoryError(
            f'recovery inventory contract field {(field or key)!r} is not a string'
        )
    return value.strip()


def _boolean(values: dict[str, object], key: str, *, field: str | None = None) -> bool:
    value = values.get(key)
    if not isinstance(value, bool):
        raise RecoveryInventoryError(
            f'recovery inventory contract field {(field or key)!r} is not boolean'
        )
    return value


def parse_recovery_contract(payload: object, target_name: str) -> ResolvedRecoveryContract:
    root = _object(payload, field='root')
    if root.get('schemaVersion') != 3:
        raise RecoveryInventoryError('recovery inventory contract has an unsupported schema version')

    target_values = _object(root.get('target'), field='target')
    server_values = _object(root.get('server'), field='server')
    network_values = _object(root.get('recoveryNetwork'), field='recoveryNetwork')
    resolved_host = _string(target_values, 'host', field='target.host')
    if resolved_host != target_name:
        raise RecoveryInventoryError('recovery inventory contract returned an unexpected target')

    target = ResolvedRecoveryTarget(
        host=resolved_host,
        inventory_endpoint=_string(
            target_values, 'inventoryEndpoint', field='target.inventoryEndpoint'
        ),
        user=_string(target_values, 'user', field='target.user'),
        status_agent_client_id=_string(
            target_values, 'statusAgentClientId', field='target.statusAgentClientId'
        ),
        recovery_enabled=_boolean(
            target_values, 'recoveryEnabled', field='target.recoveryEnabled'
        ),
        kiosk_managed=_boolean(
            target_values, 'kioskManaged', field='target.kioskManaged'
        ),
        nfc_enabled=_boolean(target_values, 'nfcEnabled', field='target.nfcEnabled'),
        barcode_enabled=_boolean(
            target_values, 'barcodeEnabled', field='target.barcodeEnabled'
        ),
        required_secrets_configured=_boolean(
            target_values,
            'requiredSecretsConfigured',
            field='target.requiredSecretsConfigured',
        ),
    )
    server = ResolvedRecoveryServer(
        host=_string(server_values, 'host', field='server.host'),
        status_agent_client_id=_string(
            server_values, 'statusAgentClientId', field='server.statusAgentClientId'
        ),
    )
    recovery_network = RecoveryNetworkReadiness(
        mode=_string(network_values, 'mode', field='recoveryNetwork.mode'),
        configured=_boolean(
            network_values, 'configured', field='recoveryNetwork.configured'
        ),
        server_endpoint=_optional_string(
            network_values, 'serverEndpoint', field='recoveryNetwork.serverEndpoint'
        ),
    )
    return ResolvedRecoveryContract(
        target=target,
        server=server,
        recovery_network=recovery_network,
    )


class AnsibleRecoveryInventoryResolver:
    """Adapter around a connection-free Ansible inventory-contract play."""

    def __init__(
        self,
        *,
        project: Path,
        inventory: Path,
        runner: RecoveryInventoryCommandRunner,
    ) -> None:
        self.project = project.resolve()
        self.inventory = inventory.resolve()
        self.runner = runner
        self.ansible_directory = self.project / 'infrastructure' / 'ansible'
        self.playbook = self.ansible_directory / 'playbooks' / 'resolve-pi4-recovery-contract.yml'

    def resolve(self, target_name: str) -> ResolvedRecoveryContract:
        if not RECOVERY_HOST_RE.fullmatch(target_name):
            raise RecoveryInventoryError(
                f'{target_name!r} is not a safe recovery inventory hostname'
            )
        try:
            with tempfile.TemporaryDirectory(prefix='pi4-recovery-contract-') as directory:
                output_path = Path(directory) / 'contract.json'
                self.runner.run(
                    [
                        'ansible-playbook',
                        '-i',
                        str(self.inventory),
                        str(self.playbook),
                        '--limit',
                        target_name,
                        '-e',
                        f'recovery_contract_output_path={output_path}',
                    ],
                    cwd=self.ansible_directory,
                )
                try:
                    payload = json.loads(output_path.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError) as error:
                    raise RecoveryInventoryError(
                        'Ansible did not produce a valid recovery inventory contract'
                    ) from error
                return parse_recovery_contract(payload, target_name)
        except RecoveryInventoryError:
            raise
        except (OSError, subprocess.SubprocessError) as error:
            raise RecoveryInventoryError(
                'Ansible could not resolve the recovery inventory contract'
            ) from error
