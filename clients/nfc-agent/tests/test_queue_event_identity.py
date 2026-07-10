from pathlib import Path

from nfc_agent.queue_store import QueueStore


def test_event_key_is_preserved_across_queue_reload(tmp_path: Path) -> None:
    database = tmp_path / "queue.db"
    store = QueueStore(database)
    event_id = store.enqueue({"uid": "abc", "eventKey": "test-event-key"})

    reloaded = QueueStore(database)
    events = reloaded.list_events()

    assert events == [
        (event_id, {"uid": "abc", "eventKey": "test-event-key"})
    ]
