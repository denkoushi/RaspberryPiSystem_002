from __future__ import annotations

import json
import unittest

from scripts.ci.validate_release_image_budget import (
    API_IMAGE_BUDGET,
    ImageBudgetError,
    select_linux_arm64_manifest,
    validate_api_image_manifest,
)


def descriptor(
    digest_char: str,
    *,
    architecture: str = "arm64",
    operating_system: str = "linux",
) -> dict[str, object]:
    return {
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": "sha256:" + digest_char * 64,
        "size": 1024,
        "platform": {
            "architecture": architecture,
            "os": operating_system,
        },
    }


def image_index() -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": [
            descriptor("a"),
            {
                **descriptor("b", architecture="unknown", operating_system="unknown"),
                "annotations": {
                    "vnd.docker.reference.type": "attestation-manifest",
                },
            },
        ],
    }


def image_manifest(
    sizes: list[int] | None = None,
) -> dict[str, object]:
    layer_sizes = sizes if sizes is not None else [400_000_000, 300_000_000, 100]
    return {
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "digest": "sha256:" + "c" * 64,
            "size": 16_312,
        },
        "layers": [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                "digest": "sha256:" + f"{index + 1:x}" * 64,
                "size": size,
            }
            for index, size in enumerate(layer_sizes)
        ],
    }


class ReleaseImageBudgetTests(unittest.TestCase):
    def test_selects_exact_linux_arm64_manifest_and_rejects_ambiguity(self) -> None:
        selected = select_linux_arm64_manifest(json.dumps(image_index()))
        self.assertEqual(selected, "sha256:" + "a" * 64)

        duplicate = image_index()
        manifests = duplicate["manifests"]
        assert isinstance(manifests, list)
        manifests.append(descriptor("d"))
        with self.assertRaisesRegex(ImageBudgetError, "exactly one"):
            select_linux_arm64_manifest(json.dumps(duplicate))

    def test_validates_bounded_compressed_manifest(self) -> None:
        result = validate_api_image_manifest(json.dumps(image_manifest()))
        self.assertEqual(result.layer_count, 3)
        self.assertEqual(result.total_bytes, 700_000_100)
        self.assertEqual(result.largest_layer_bytes, 400_000_000)

    def test_rejects_total_largest_layer_and_layer_count_over_budget(self) -> None:
        with self.assertRaisesRegex(ImageBudgetError, "total"):
            validate_api_image_manifest(
                json.dumps(
                    image_manifest(
                        [
                            API_IMAGE_BUDGET.max_total_bytes // 2,
                            API_IMAGE_BUDGET.max_total_bytes // 2 + 1,
                        ]
                    )
                )
            )
        with self.assertRaisesRegex(ImageBudgetError, "single layer"):
            validate_api_image_manifest(
                json.dumps(
                    image_manifest([API_IMAGE_BUDGET.max_layer_bytes + 1])
                )
            )
        with self.assertRaisesRegex(ImageBudgetError, "layer count"):
            validate_api_image_manifest(
                json.dumps(
                    image_manifest([1] * (API_IMAGE_BUDGET.max_layers + 1))
                )
            )

    def test_rejects_duplicate_keys_wrong_document_and_malformed_sizes(self) -> None:
        raw = json.dumps(image_manifest())
        duplicate = raw.replace('"schemaVersion": 2', '"schemaVersion": 2, "schemaVersion": 2')
        with self.assertRaisesRegex(ImageBudgetError, "duplicate"):
            validate_api_image_manifest(duplicate)
        with self.assertRaisesRegex(ImageBudgetError, "image manifest"):
            validate_api_image_manifest(json.dumps(image_index()))
        for invalid_size in (True, -1, 1.5, "1"):
            document = image_manifest()
            layers = document["layers"]
            assert isinstance(layers, list)
            assert isinstance(layers[0], dict)
            layers[0]["size"] = invalid_size
            with self.assertRaisesRegex(ImageBudgetError, "size"):
                validate_api_image_manifest(json.dumps(document))

    def test_rejects_unknown_fields_bad_digest_and_oversized_input(self) -> None:
        document = image_manifest()
        document["unexpected"] = True
        with self.assertRaisesRegex(ImageBudgetError, "fields"):
            validate_api_image_manifest(json.dumps(document))

        document = image_manifest()
        layers = document["layers"]
        assert isinstance(layers, list)
        assert isinstance(layers[0], dict)
        layers[0]["digest"] = "latest"
        with self.assertRaisesRegex(ImageBudgetError, "digest"):
            validate_api_image_manifest(json.dumps(document))

        with self.assertRaisesRegex(ImageBudgetError, "size limit"):
            validate_api_image_manifest(" " * (1_048_576 + 1))


if __name__ == "__main__":
    unittest.main()
