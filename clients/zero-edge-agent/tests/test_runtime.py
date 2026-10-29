import os
from pathlib import Path
import select
import shutil
import subprocess
import sys

from zero_edge_agent.queue import ScanQueue

ROOT = Path(__file__).resolve().parents[3]


def test_copied_status_agent_imports_without_repository(tmp_path):
    destination = tmp_path / "opt" / "zero-edge" / "status-agent"
    destination.mkdir(parents=True)
    for source in (ROOT / "clients/status-agent").glob("*.py"):
        shutil.copyfile(source, destination / source.name)
    source = ROOT / "scripts/deploy/rolling_release/terminal_device_maintenance.py"
    shutil.copyfile(source, destination / source.name)
    env = {key: value for key, value in os.environ.items() if key not in ("PYTHONPATH", "PYTHONHOME")}
    result = subprocess.run([sys.executable, "-S", str(destination / "status-agent.py"), "--help"],
                            cwd=tmp_path, env=env, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert "Raspberry Pi status agent" in result.stdout


def test_sigterm_while_stop_lock_is_held_does_not_deadlock():
    # Deterministically hit the window inside Event.wait() where the main thread holds the lock.
    script = """
import os, signal, threading
from zero_edge_agent.main import install_stop_handlers
stop = threading.Event()
install_stop_handlers(stop)
with stop._cond:
    os.kill(os.getpid(), signal.SIGTERM)
assert stop.wait(5)
print('STOPPED', flush=True)
"""
    env = dict(os.environ, PYTHONPATH=str(ROOT / "clients/zero-edge-agent"))
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True,
                            text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "STOPPED"


def test_sigterm_stops_reader_and_sender_and_closes_queue(tmp_path):
    queue_path = tmp_path / "queue.db"
    config = tmp_path / "agent.conf"
    config.write_text('API_BASE_URL="https://example.test"\nX_CLIENT_KEY="secret"\n'
                      'QUEUE_PATH="%s"\n' % queue_path)
    script = """
import sys
import types
import zero_edge_agent.clock
zero_edge_agent.clock.is_synchronized = lambda: False
def devices():
    print('READY', flush=True)
    return []
sys.modules['evdev'] = types.SimpleNamespace(list_devices=devices)
from zero_edge_agent.main import main
raise SystemExit(main())
"""
    env = dict(os.environ, ZERO_EDGE_AGENT_CONFIG=str(config),
               PYTHONPATH=str(ROOT / "clients/zero-edge-agent"))
    process = subprocess.Popen([sys.executable, "-c", script], env=env, cwd=tmp_path,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert select.select([process.stdout], [], [], 5)[0], "Reader did not start"
        assert process.stdout.readline().strip() == "READY"
        process.terminate()
        _, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr
        assert "shutdown complete" in stderr
        assert "secret" not in stderr
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
    queue = ScanQueue(queue_path)
    assert queue.oldest() is None
    queue.close()
