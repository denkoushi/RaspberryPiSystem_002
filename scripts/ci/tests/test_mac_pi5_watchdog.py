"""Include Mac watchdog command-stub tests in repo-policy discovery (Linux too)."""
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[2] / 'mac/pi5-watchdog/tests/test_watchdog.py'
spec = importlib.util.spec_from_file_location('mac_pi5_watchdog_tests', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
WatchdogTest = module.WatchdogTest

tls_path = path.with_name('test_tls.py')
tls_spec = importlib.util.spec_from_file_location('mac_pi5_watchdog_tls_tests', tls_path)
tls_module = importlib.util.module_from_spec(tls_spec)
tls_spec.loader.exec_module(tls_module)
TlsTest = tls_module.TlsTest
