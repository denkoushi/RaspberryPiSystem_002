import unittest

from scripts.deploy.rolling_release.image_refs import (
    image_matches_release,
    release_sha_from_image,
)


SHA = "a" * 40


class Pi5ImageReferenceTest(unittest.TestCase):
    def test_legacy_and_run_scoped_tags_are_strictly_compatible(self):
        for suffix in ("b" * 12, "b" * 12 + "-" + "c" * 64):
            image = f"registry.example/raspi/api:{SHA}-{suffix}"
            with self.subTest(image=image):
                self.assertEqual(release_sha_from_image(image), SHA)
                self.assertTrue(image_matches_release(image, SHA))

    def test_malformed_or_ambiguous_tags_fail_closed(self):
        for image in (
            f"api:{SHA}-{'b' * 11}",
            f"api:{SHA}-{'b' * 12}-{'c' * 63}",
            f"api:{SHA}-{'b' * 12}-{'C' * 64}",
            f"api:prefix-{SHA}-{'b' * 12}",
            f"api:{SHA}-{'b' * 12}-{'c' * 64}-extra",
            SHA + "-" + "b" * 12,
        ):
            with self.subTest(image=image):
                self.assertIsNone(release_sha_from_image(image))
                self.assertFalse(image_matches_release(image, SHA))


if __name__ == "__main__":
    unittest.main()
