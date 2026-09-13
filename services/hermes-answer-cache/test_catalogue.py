import json
import tempfile
import unittest
from pathlib import Path
from server import read_catalogue, identifiers


class CatalogueTests(unittest.TestCase):
    def test_different_numeric_conditions_are_not_equivalent(self):
        self.assertEqual(identifiers('品番ＭＤ００００５３４４１、Ｍ１６、1.5mm'), {'md000053441', 'm16', '1.5mm'})
        self.assertNotEqual(identifiers('品番MD005280430'), identifiers('品番MD000053441'))

    def test_only_source_reviewed_complete_answers_are_admitted(self):
        case = {"question": "部品Aの検査は？", "answer": "確認済みの回答",
                "sources": [{"kind": "nonconformity", "id": "record", "sha256": "a" * 64}],
                "review": {"verdict": "pass", "reviewer": "source-reviewer", "reason": "原文と照合", "reviewedAt": "2026-09-13"}}
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "reviewed.json"
            path.write_text(json.dumps({"version": 1, "cases": [case]}))
            self.assertEqual(read_catalogue(path)[case["question"]]["answer"], case["answer"])
            for invalid in [dict(case, review={}), dict(case, sources=[]), dict(case, answer="")]:
                path.write_text(json.dumps({"version": 1, "cases": [invalid]}))
                with self.assertRaises(ValueError):
                    read_catalogue(path)
            path.write_text(json.dumps({"version": 1, "cases": [case, case]}))
            with self.assertRaises(ValueError):
                read_catalogue(path)


class SourceChoiceTests(unittest.TestCase):
    def test_choices_keep_record_identity_and_bound_the_label(self):
        from sources import source_option
        self.assertEqual(source_option({'kind': 'equipment_manual', 'id': '1', 'title': '設備Aの点検', 'text': '点検原文'}), 'この資料で回答：設備Aの点検')



if __name__ == "__main__":
    unittest.main()
