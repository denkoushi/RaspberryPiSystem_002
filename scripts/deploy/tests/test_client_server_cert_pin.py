"""Offline certificate-pin contracts; never load host_vars or deployment credentials."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import tempfile
import unittest
from unittest.mock import patch

import yaml
from jinja2 import Environment, StrictUndefined, Undefined, UndefinedError

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'
for directory in ('status-agent', 'haizen-agent', 'torque-agent'):
    sys.path.insert(0, str(ROOT / 'clients' / directory))
from haizen_agent.api_client import build_tls_context as haizen_context
from haizen_agent.config import load_haizen_config
from torque_agent.config import AgentConfig, build_tls_context as torque_context

spec = importlib.util.spec_from_file_location('status_agent_pin_test', ROOT / 'clients/status-agent/status-agent.py')
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


def certificate(directory, name):
    cert, key = directory / (name + '.pem'), directory / (name + '.key')
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        from datetime import datetime, timedelta, timezone
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'different.example')])
        now = datetime.now(timezone.utc)
        leaf = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                .public_key(private.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                .sign(private, hashes.SHA256()))
        assert len(leaf.extensions) == 0
        cert.write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        key.write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                             serialization.NoEncryption()))
    except ImportError:
        if not shutil.which('openssl'):
            raise unittest.SkipTest('cryptography and openssl unavailable')
        config = directory / 'openssl.cnf'
        config.write_text('[req]\ndistinguished_name=dn\n[dn]\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=different.example', '-config', str(config),
                        '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True)
    return cert, key


def handshake(ctx, cert, key, command=None):
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(cert, key)
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', 0))
        except PermissionError:
            raise unittest.SkipTest('sandbox prohibits loopback bind; MemoryBIO handshake is tested separately')
        listener.listen(1)
        listener.settimeout(5)
        errors = []
        def serve():
            try:
                with listener.accept()[0] as raw:
                    raw.settimeout(5)
                    with server_ctx.wrap_socket(raw, server_side=True) as stream:
                        if command:
                            stream.recv(4096)
                            stream.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
            except (ssl.SSLError, ConnectionError):
                pass  # Rejected clients abort the server handshake.
            except Exception as exc:
                errors.append(exc)
        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            port = listener.getsockname()[1]
            if command:
                return command(port)
            with socket.create_connection(('127.0.0.1', port), timeout=5) as raw:
                with ctx.wrap_socket(raw, server_hostname='127.0.0.1'):
                    pass
        finally:
            thread.join(6)
            assert not thread.is_alive()
            assert not errors


BUILDERS = [lambda path: status.build_tls_context({'TLS_CA_FILE': str(path), 'TLS_SKIP_VERIFY': '1'}),
            lambda path: haizen_context(True, str(path)),
            lambda path: torque_context('pinned', str(path))]


def template_environment():
    env = Environment(undefined=StrictUndefined, trim_blocks=True, keep_trailing_newline=True)
    env.filters.update(bool=lambda v: str(v).lower() in ('true', '1', 'yes', 'on'),
                       to_json=json.dumps, ternary=lambda v, a, b: a if v else b,
                       mandatory=mandatory_filter)
    return env


def mandatory_filter(value, msg=None):
    if isinstance(value, Undefined):
        raise UndefinedError(msg or 'Mandatory variable is undefined')
    return value


def inventory_hosts(document):
    result = {}
    def visit(group, inherited):
        values = {**inherited, **group.get('vars', {})}
        for name, host in group.get('hosts', {}).items():
            result.setdefault(name, {}).update({**values, **(host or {})})
        for child in group.get('children', {}).values():
            visit(child or {}, values)
    visit(document['all'], {})
    return result


TEMPLATES = ['templates/status-agent.conf.j2', 'templates/raspi-haizen-agent.conf.j2',
             'templates/torque-agent.env.j2', 'roles/signage/templates/signage-runtime.env.j2',
             'roles/release_kiosk/templates/client-compose.yml.j2']


PIN_MARKERS = ('TLS_CA_FILE', 'pinned', 'SIGNAGE_SERVER_CERT', '/etc/raspi-client')


def signage_options(environment):
    script = (ANSIBLE / 'roles/signage/templates/signage-update.sh.j2').read_text()
    prefix = script.split('\ncurl_with_client_key()', 1)[0]
    env = {**os.environ, **{name: 'fixture' for name in ('SIGNAGE_SERVER_URL', 'SIGNAGE_IMAGE_CLIENT_KEY',
                                                     'SIGNAGE_STATUS_CLIENT_ID', 'SIGNAGE_STATUS_CLIENT_KEY')},
           **environment}
    return subprocess.run(['bash', '-c', prefix + '\nprintf "%s\\n" "${CURL_OPTIONS[@]}"'],
                          env=env, text=True, capture_output=True)


class ClientServerCertPinTests(unittest.TestCase):
    def test_legacy_modes_keep_their_behavior(self):
        self.assertEqual(status.build_tls_context({'TLS_SKIP_VERIFY': '1'}).verify_mode, ssl.CERT_NONE)
        self.assertTrue(status.build_tls_context({}).check_hostname)
        self.assertEqual(haizen_context(True).verify_mode, ssl.CERT_NONE)
        self.assertTrue(haizen_context(False).check_hostname)
        self.assertIs(torque_context('system'), True)
        self.assertIs(torque_context('insecure'), False)

    def test_flag_off_templates_render_no_pin_settings_for_every_inventory_host(self):
        for relative in TEMPLATES:
            with self.subTest(relative=relative):
                current = inventory_hosts(yaml.safe_load((ANSIBLE / 'inventory.yml').read_text()))
                env = template_environment()
                defaults = dict(status_agent_client_id='fixture', status_agent_client_key='fixture',
                                haizen_agent_api_base_url='https://127.0.0.1', torque_agent_api_base_url='https://127.0.0.1',
                                torque_agent_client_key='fixture', torque_agent_hid_devices=[], ansible_user='fixture',
                                release_kiosk_services=['torque-agent'], release_kiosk_compose_images={'torque-agent': 'fixture'},
                                release_kiosk_project_dir='/opt/fixture',
                                release_kiosk_hardened_gids={'plugdev': '46', 'dialout': '20', 'input': '996'})
                template = env.from_string((ANSIBLE / relative).read_text())
                for host, values in current.items():
                    self.assertFalse(values.get('client_server_cert_pin_enabled', False), host)
                    rendered = template.render({**defaults, **values})
                    for marker in PIN_MARKERS:
                        self.assertNotIn(marker, rendered, (host, marker))

    def test_zero_edge_heartbeat_forces_pin_off(self):
        playbook = (ANSIBLE / 'playbooks/zero-edge.yml').read_text()
        block = playbook[playbook.index('- name: Configure heartbeat'):]
        block = block[:block.index('- name:', 1)]
        self.assertIn('client_server_cert_pin_enabled: false', block)

    def test_enabled_templates_select_pin(self):
        env = template_environment()
        values = dict(client_server_cert_pin_enabled=True, status_agent_client_id='fixture',
                      status_agent_client_key='fixture', haizen_agent_api_base_url='https://127.0.0.1',
                      torque_agent_api_base_url='https://127.0.0.1', torque_agent_client_key='fixture',
                      torque_agent_hid_devices=[], ansible_user='fixture', kiosk_server_cert_spki_sha256='A'*43+'=')
        for relative, expected in zip(TEMPLATES[:4], ['TLS_CA_FILE=', 'HAIZEN_TLS_VERIFY_MODE="pinned"',
                                                    'TORQUE_TLS_VERIFY_MODE=pinned', 'SIGNAGE_SERVER_CERT_PIN_ENABLED=1']):
            self.assertIn(expected, env.from_string((ANSIBLE / relative).read_text()).render(values))

    def test_shared_ansible_role_and_release_wiring(self):
        role = yaml.safe_load((ANSIBLE / 'roles/client_server_cert_pin/tasks/main.yml').read_text())[0]
        self.assertEqual(role['when'], 'client_server_cert_pin_enabled | default(false) | bool')
        tasks = role['block']
        self.assertEqual(tasks[0]['delegate_to'], 'localhost')
        self.assertIs(tasks[0]['become'], False)
        self.assertEqual(tasks[0]['ansible.builtin.stat']['checksum_algorithm'], 'sha256')
        check = tasks[1]['ansible.builtin.assert']
        self.assertTrue(any('stat.checksum' in value and 'client_server_cert_sha256' in value for value in check['that']))
        self.assertIn('一致しません', check['fail_msg'])
        copy = tasks[-1]['ansible.builtin.copy']
        self.assertEqual((copy['dest'], copy['owner'], copy['group'], copy['mode']), ('/etc/raspi-client/server-cert.pem', 'root', 'root', '0644'))
        for entry in ('client/tasks/main', 'signage/tasks/main',
                      'release_kiosk/tasks/prepare', 'release_signage/tasks/prepare'):
            tasks = yaml.safe_load((ANSIBLE / ('roles/' + entry + '.yml')).read_text())
            pin_index = next(index for index, task in enumerate(tasks)
                             if task.get('ansible.builtin.import_role', {}).get('name') == 'client_server_cert_pin')
            template_index = next(index for index, task in enumerate(tasks) if 'ansible.builtin.template' in task)
            self.assertLess(pin_index, template_index)
        compose = (ROOT / 'infrastructure/docker/docker-compose.client.yml').read_text()
        self.assertIn('/etc/raspi-client:/etc/raspi-client:ro', compose)
        release = (ANSIBLE / 'roles/release_kiosk/templates/client-compose.yml.j2').read_text()
        self.assertIn('/etc/raspi-client:/etc/raspi-client:ro', release)

    def test_signage_flag_off_preserves_curl_arguments(self):
        for insecure in ['0', '1']:
            with self.subTest(insecure=insecure):
                result = signage_options({'SIGNAGE_ALLOW_INSECURE_TLS': insecure, 'SIGNAGE_SERVER_CERT_PIN_ENABLED': '0'})
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.splitlines(), ['-sS', '-f'] + (['-k'] if insecure == '1' else []))

    def test_signage_enabled_requires_pin(self):
        result = signage_options({'SIGNAGE_SERVER_CERT_PIN_ENABLED': '1', 'SIGNAGE_SERVER_CERT_SPKI': ''})
        self.assertEqual(result.returncode, 2)

    def test_controller_certificate_assertion_rejects_invalid_inputs(self):
        for exists, symlink, digest, accepted in [
            (True, False, 'a'*64, True), (False, False, 'a'*64, False),
            (True, True, 'a'*64, False), (True, False, 'b'*64, False),
            (True, False, '', False),
        ]:
            with self.subTest(exists=exists, symlink=symlink, digest=digest, accepted=accepted):
                import re
                env = template_environment()
                env.tests['match'] = lambda value, pattern: re.match(pattern, value) is not None
                role = yaml.safe_load((ANSIBLE / 'roles/client_server_cert_pin/tasks/main.yml').read_text())[0]
                checks = role['block'][1]['ansible.builtin.assert']['that']
                variables = dict(client_server_cert_sha256='a'*64,
                                 client_server_controller_cert={'stat': dict(exists=exists, isreg=exists,
                                                                             islnk=symlink, checksum=digest)})
                self.assertIs(all(env.compile_expression(check)(variables) for check in checks), accepted)


class ClientServerCertPinCertificateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = tempfile.TemporaryDirectory(prefix='client-pin')
        cls.addClassCleanup(directory.cleanup)
        path = Path(directory.name)
        cls.certificates = certificate(path, 'server'), certificate(path, 'other')

    def test_real_no_extension_tls_handshake(self):
        for wrong_pin in [False, True]:
            with self.subTest(wrong_pin=wrong_pin):
                for name, builder in zip(('status', 'haizen', 'torque'), BUILDERS):
                    with self.subTest(builder=name):
                        (cert, key), (other, _) = self.certificates
                        original = ssl.create_default_context
                        def strict_default(*args, **kwargs):
                            ctx = original(*args, **kwargs)
                            ctx.verify_flags |= getattr(ssl, 'VERIFY_X509_STRICT', 0)
                            return ctx
                        with patch('ssl.create_default_context', side_effect=strict_default):
                            ctx = builder(other if wrong_pin else cert)
                        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
                        self.assertIs(ctx.check_hostname, False)
                        self.assertFalse(ctx.verify_flags & getattr(ssl, 'VERIFY_X509_STRICT', 0))
                        self.assertEqual(ctx.cert_store_stats()['x509'], 1)
                        if wrong_pin:
                            with self.assertRaises(ssl.SSLCertVerificationError):
                                handshake(ctx, cert, key)
                        else:
                            handshake(ctx, cert, key)

    def test_pinned_config_and_missing_ca_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            with patch.dict(os.environ):
                (cert, _), _ = self.certificates
                os.environ['CONFIG_PATH'] = str(tmp_path / 'absent.conf')
                os.environ.pop('TLS_SKIP_VERIFY', None)
                os.environ['API_BASE_URL'] = 'https://127.0.0.1'
                os.environ['X_CLIENT_KEY'] = 'fixture'
                os.environ['HAIZEN_TLS_VERIFY_MODE'] = 'pinned'
                os.environ['TORQUE_API_BASE_URL'] = 'https://127.0.0.1'
                os.environ['TORQUE_CLIENT_KEY'] = 'fixture'
                os.environ['TORQUE_TLS_VERIFY_MODE'] = 'pinned'
                for variable in ('HAIZEN_TLS_CA_FILE', 'TORQUE_TLS_CA_FILE'):
                    os.environ.pop(variable, None)
                with self.assertRaisesRegex(ValueError, 'CA_FILE'):
                    load_haizen_config()
                with self.assertRaisesRegex(ValueError, 'CA_FILE'):
                    AgentConfig.from_env()
                os.environ['HAIZEN_TLS_CA_FILE'] = str(cert)
                os.environ['TORQUE_TLS_CA_FILE'] = str(cert)
                os.environ['TLS_SKIP_VERIFY'] = '1'
                self.assertEqual(load_haizen_config().tls_verify_mode, 'pinned')
                self.assertEqual(load_haizen_config().tls_ca_file, str(cert))
                self.assertIsInstance(AgentConfig.from_env().tls_verify, ssl.SSLContext)
                for builder in BUILDERS:
                    with self.assertRaises(FileNotFoundError):
                        builder(tmp_path / 'missing.pem')

    def test_curl_pin_is_enforced_with_insecure(self):
        for wrong_pin in [False, True]:
            with self.subTest(wrong_pin=wrong_pin):
                if not shutil.which('curl') or not shutil.which('openssl'):
                    self.skipTest('curl/openssl unavailable')
                (cert, key), (other, _) = self.certificates
                public = subprocess.run(['openssl', 'x509', '-in', str(other if wrong_pin else cert), '-pubkey', '-noout'],
                                        check=True, capture_output=True).stdout
                der = subprocess.run(['openssl', 'pkey', '-pubin', '-outform', 'DER'], input=public,
                                     check=True, capture_output=True).stdout
                import base64
                import hashlib
                pin = base64.b64encode(hashlib.sha256(der).digest()).decode()
                result = signage_options({'SIGNAGE_SERVER_CERT_PIN_ENABLED': '1', 'SIGNAGE_SERVER_CERT_SPKI': pin})
                self.assertEqual(result.returncode, 0)
                args = result.stdout.splitlines()
                response = handshake(None, cert, key, lambda port: subprocess.run(
                    ['curl', '--noproxy', '*', '--max-time', '5', *args, f'https://127.0.0.1:{port}'], capture_output=True))
                self.assertEqual(response.returncode, 90 if wrong_pin else 0)

    def test_no_extension_handshake_without_socket(self):
        """Same TLS protocol in memory, also runnable where loopback bind is prohibited."""
        for wrong_pin in [False, True]:
            with self.subTest(wrong_pin=wrong_pin):
                for name, builder in zip(('status', 'haizen', 'torque'), BUILDERS):
                    with self.subTest(builder=name):
                        (cert, key), (other, _) = self.certificates
                        client_ctx = builder(other if wrong_pin else cert)
                        server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        server_ctx.load_cert_chain(cert, key)
                        client_in, client_out, server_in, server_out = [ssl.MemoryBIO() for _ in range(4)]
                        client = client_ctx.wrap_bio(client_in, client_out, server_hostname='127.0.0.1')
                        server = server_ctx.wrap_bio(server_in, server_out, server_side=True)
                        def exchange():
                            done = [False, False]
                            for _ in range(20):
                                for index, endpoint in enumerate((client, server)):
                                    if not done[index]:
                                        try:
                                            endpoint.do_handshake()
                                            done[index] = True
                                        except ssl.SSLWantReadError:
                                            pass
                                server_in.write(client_out.read())
                                client_in.write(server_out.read())
                                if all(done):
                                    return
                            self.fail('TLS handshake did not finish')
                        if wrong_pin:
                            with self.assertRaises(ssl.SSLCertVerificationError):
                                exchange()
                        else:
                            exchange()

    def test_httpx_senders_and_leases_receive_the_pinned_context(self):
        if importlib.util.find_spec('httpx') is None:
            self.skipTest('httpx unavailable; the torque-agent tests cover this path')
        from torque_agent.api_client import HttpxTorqueRecordApi
        from torque_agent.connection_lease import LeaseApiClient
        (cert, _), _ = self.certificates
        ctx = torque_context('pinned', str(cert))
        with patch('torque_agent.api_client.httpx.AsyncClient') as client:
            HttpxTorqueRecordApi('https://127.0.0.1', 'fixture', tls_verify=ctx)
            self.assertIs(client.call_args.kwargs['verify'], ctx)
        # LeaseApiClient retains this same context for each request.
        lease = LeaseApiClient('https://127.0.0.1', 'fixture', tls_verify=ctx)
        self.assertIs(lease._tls_verify, ctx)

    def test_signage_release_proof_uses_deployed_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp_path = Path(directory)
            spec = importlib.util.spec_from_file_location('signage_pin_proof', ROOT / 'scripts/deploy/signage-runtime-proof.py')
            proof = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = proof
            spec.loader.exec_module(proof)
            config = tmp_path / 'runtime.conf'
            config.write_text('SIGNAGE_SERVER_URL="https://127.0.0.1"\n'
                              'SIGNAGE_IMAGE_CLIENT_KEY="fixture"\n'
                              'SIGNAGE_ALLOW_INSECURE_TLS=0\nSIGNAGE_SERVER_CERT_PIN_ENABLED=1\n')
            (cert, _), _ = self.certificates
            original = ssl.create_default_context
            with patch.object(proof.ssl, 'create_default_context', side_effect=lambda **kwargs: original(cafile=str(cert))) as build:
                _, _, context = proof._runtime_configuration(config)
            build.assert_called_once_with(cafile='/etc/raspi-client/server-cert.pem')
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertFalse(context.check_hostname)
            self.assertFalse(context.verify_flags & getattr(ssl, 'VERIFY_X509_STRICT', 0))
