import base64
import importlib.util
import json
import math
import os
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "embedding-server.py"


def load_module(**env):
    defaults = {
        "EMBEDDING_BACKEND": "clip",
        "EMBEDDING_TRUNCATE_DIM": "",
        "EMBEDDING_NORMALIZE": "true",
        "EMBEDDING_MODEL_ID": "",
        "EMBEDDING_HF_MODEL": "",
        "EMBEDDING_DEVICE": "cpu",
    }
    with patch.dict(os.environ, {**defaults, **env}):
        spec = importlib.util.spec_from_file_location("dgx_embedding_server", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module


class MemoryConnection:
    def __init__(self, request):
        self.request = BytesIO(request)
        self.response = BytesIO()

    def makefile(self, mode, *args):
        return self.request

    def sendall(self, data):
        self.response.write(data)


def request(module, method, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else b""
    connection = MemoryConnection(
        f"{method} {path} HTTP/1.0\r\nContent-Length: {len(body)}\r\n\r\n".encode() + body
    )
    module.Handler(connection, ("127.0.0.1", 12345), SimpleNamespace())
    headers, response = connection.response.getvalue().split(b"\r\n\r\n", 1)
    return int(headers.split()[1]), response


class EmbeddingServerTests(unittest.TestCase):
    def test_import_without_model_dependencies_preserves_defaults(self):
        with patch.dict(sys.modules, {name: None for name in ("torch", "transformers", "sentence_transformers", "PIL")}):
            module = load_module()
        self.assertEqual(module.BACKEND, "clip")
        self.assertEqual(module.MODEL_ID, "clip-ViT-B-32")
        self.assertEqual(module.HF_MODEL, "openai/clip-vit-base-patch32")
        self.assertIsNone(module.IMAGE_EMBEDDER)
        self.assertIsNone(module.TRUNCATE_DIM)

    def test_truncate_and_renormalize_fake_backend(self):
        for backend in ("clip", "embeddinggemma2"):
            with self.subTest(backend=backend):
                module = load_module(EMBEDDING_BACKEND=backend, EMBEDDING_TRUNCATE_DIM="2")
                module.IMAGE_EMBEDDER = Mock(return_value=[3.0, 4.0, 12.0])
                vector = module.image_embedding_from_jpeg(b"fake-jpeg")
                self.assertEqual(len(vector), 2)
                self.assertEqual(vector, [0.6, 0.8])
                self.assertAlmostEqual(math.sqrt(sum(v * v for v in vector)), 1.0)
                module.IMAGE_EMBEDDER.assert_called_once_with(b"fake-jpeg")

    def test_truncate_without_normalization(self):
        module = load_module(EMBEDDING_TRUNCATE_DIM="2", EMBEDDING_NORMALIZE="false")
        module.IMAGE_EMBEDDER = lambda jpeg: [3.0, 4.0, 12.0]
        self.assertEqual(module.image_embedding_from_jpeg(b"fake-jpeg"), [3.0, 4.0])

    def test_no_truncation_preserves_vector(self):
        module = load_module()
        module.IMAGE_EMBEDDER = lambda jpeg: [3.0, 4.0, 12.0]
        self.assertEqual(module.image_embedding_from_jpeg(b"fake-jpeg"), [3.0, 4.0, 12.0])

    def test_invalid_truncate_dimension_at_import(self):
        for value in ("0", "-1", "1.5", "invalid"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "EMBEDDING_TRUNCATE_DIM"):
                load_module(EMBEDDING_TRUNCATE_DIM=value)

    def test_truncate_dimension_exceeding_vector_length(self):
        module = load_module(EMBEDDING_TRUNCATE_DIM="4")
        module.IMAGE_EMBEDDER = lambda jpeg: [3.0, 4.0, 12.0]
        with self.assertRaisesRegex(ValueError, "EMBEDDING_TRUNCATE_DIM.*between 1 and 3"):
            module.image_embedding_from_jpeg(b"fake-jpeg")

    def test_unknown_backend_at_import(self):
        with self.assertRaisesRegex(ValueError, "Unknown EMBEDDING_BACKEND.*unknown"):
            load_module(EMBEDDING_BACKEND="unknown")

    def test_embeddinggemma2_load_and_encode_contract(self):
        module = load_module(EMBEDDING_BACKEND="embeddinggemma2", EMBEDDING_HF_MODEL="google/embeddinggemma-2")
        image = Mock()
        image.convert.return_value = rgb_image = object()
        image_api = SimpleNamespace(open=Mock(return_value=image))
        model = Mock()
        model.encode.return_value = [[0.6, 0.8]]
        constructor = Mock(return_value=model)
        with patch.dict(sys.modules, {
            "torch": SimpleNamespace(),
            "PIL": SimpleNamespace(Image=image_api),
            "sentence_transformers": SimpleNamespace(SentenceTransformer=constructor),
            "transformers": None,
        }):
            module.IMAGE_EMBEDDER = module.load_image_embedder()
            vector = module.image_embedding_from_jpeg(b"fake-jpeg")
        constructor.assert_called_once_with("google/embeddinggemma-2", device="cpu", config_kwargs={"audio_config": None})
        image.convert.assert_called_once_with("RGB")
        model.encode.assert_called_once_with([rgb_image], normalize_embeddings=True)
        self.assertEqual(vector, [0.6, 0.8])

    def test_embed_default_and_overridden_model_id(self):
        module = load_module()
        module.IMAGE_EMBEDDER = Mock(return_value=[0.6, 0.8])
        encoded = base64.b64encode(b"fake-jpeg").decode()
        for override, expected in ((None, "clip-ViT-B-32"), ("new-model", "new-model")):
            with self.subTest(model_id=override):
                payload = {"jpegBase64": encoded}
                if override is not None:
                    payload["modelId"] = override
                status, body = request(module, "POST", "/embed", payload)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), {"embedding": [0.6, 0.8], "modelId": expected})
        self.assertEqual(module.IMAGE_EMBEDDER.call_count, 2)
        module.IMAGE_EMBEDDER.assert_called_with(b"fake-jpeg")

    def test_embed_missing_jpeg_base64(self):
        module = load_module()
        module.IMAGE_EMBEDDER = Mock()
        status, body = request(module, "POST", "/embed", {})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body), {"error": "jpegBase64 is required"})
        module.IMAGE_EMBEDDER.assert_not_called()

    def test_healthz_without_loading_model(self):
        module = load_module()
        status, body = request(module, "GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"ok\n")
        self.assertIsNone(module.IMAGE_EMBEDDER)


if __name__ == "__main__":
    unittest.main()
