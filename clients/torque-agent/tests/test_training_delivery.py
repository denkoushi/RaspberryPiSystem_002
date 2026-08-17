import asyncio
from pathlib import Path

from torque_agent.api_client import OutboxSender
from torque_agent.binding import BindingStore
from torque_agent.ingestor import TorqueEventIngestor
from torque_agent.models import WorkBinding
from torque_agent.parser_registry import SyntheticDelimitedFixtureParser
from torque_agent.queue_store import QueueStore


def test_training_binding_uses_agent_dto_without_assembly_or_raw_payload(tmp_path: Path) -> None:
    device = Path('/dev/input/by-id/training-wrench')
    queue = QueueStore(tmp_path / 'outbox.sqlite3')
    parser = SyntheticDelimitedFixtureParser()
    bindings = BindingStore(ttl_seconds=5)
    bindings.update(WorkBinding('training-session', '', 'confirmation', 'profile', 'lease', 3, 'training'))
    ingestor = TorqueEventIngestor(
        queue=queue,
        bindings=bindings,
        parsers={device: parser},
        parser_profiles={device: parser.PROFILE},
        event_id_factory=lambda: 'training-event-1',
        captured_at_factory=lambda: '2026-08-09T00:00:00Z',
    )

    asyncio.run(ingestor.on_line(device, 'FIXTURE|serial=SN|value=10|unit=N-m|memory=7'))
    payload = queue.pending()[0][1]['payload']
    assert payload['targetKind'] == 'training'
    assert payload['torqueWrenchProfileId'] == 'profile'
    assert 'expectedTemplateBoltId' not in payload
    assert 'rawPayload' not in payload


def test_training_outbox_routes_to_training_attempt_endpoint(tmp_path: Path, monkeypatch) -> None:
    captured = {}
    queue = QueueStore(tmp_path / 'outbox.sqlite3')
    # Legacy training rows may not have the newly required profile field. The
    # sender must still deserialize and replay them without rewriting the row.
    queue.enqueue('event-1', {'sessionId': 'training-session', 'payload': {'targetKind': 'training', 'confirmationId': 'c', 'serialNumber': 'SN', 'value': 10, 'unit': 'N-m'}})

    class Response:
        status_code = 201
        text = ''

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def aclose(self):
            return None

        async def post(self, url, **kwargs):
            captured['url'] = url
            captured['json'] = kwargs['json']
            return Response()

    monkeypatch.setattr('torque_agent.api_client.httpx.AsyncClient', Client)
    assert asyncio.run(OutboxSender('http://server', 'client', queue).send_once()) is True
    assert captured['url'].endswith('/api/torque-training/sessions/training-session/attempts/from-agent')
    assert captured['json'] == {
        'confirmationId': 'c',
        'serialNumber': 'SN',
        'value': 10,
        'unit': 'N-m',
        'sourceEventKey': 'event-1',
    }
