from __future__ import annotations

import signal
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google_drive_dr.command_port import CommandError, SubprocessCommandPort


class SubprocessCommandPortTests(unittest.TestCase):
    def test_terminate_active_stops_the_child_process_group(self) -> None:
        commands = SubprocessCommandPort()
        observed: list[BaseException] = []

        def run_child() -> None:
            try:
                commands.run(
                    [
                        sys.executable,
                        "-c",
                        "import time; time.sleep(30)",
                    ]
                )
            except CommandError as error:
                observed.append(error)

        worker = threading.Thread(target=run_child, daemon=True)
        worker.start()
        for _ in range(100):
            with commands._lock:
                if commands._active is not None:
                    break
            time.sleep(0.01)
        else:
            self.fail("child process did not start")

        commands.terminate_active()
        worker.join(timeout=3)

        self.assertFalse(worker.is_alive())
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0].returncode, -signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
