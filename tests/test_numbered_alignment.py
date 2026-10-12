import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from dialogue_units import extract_units, label_number
from sentence_alignment import align, normalized


class NumberedAlignmentTests(unittest.TestCase):
    def test_numbering_controls_count_despite_multiple_sentences_or_missing_punctuation(self):
        items = [{"line": 1, "text": "Hallo! Wie geht es dir?"}, {"line": 2, "text": "Gut · Danke!"}]
        text = normalized(" ".join(item["text"] for item in items))
        tokens = [(char, index * .1) for index, char in enumerate(text)]
        boundary = len(normalized(items[0]["text"])) * .1
        result = align(tokens, items, 0, 5, [(boundary - .15, boundary + .15)], 2)
        self.assertEqual(result["expectedSentenceCount"], 2)
        self.assertEqual(len(result["sentenceSegments"]), 2)
        self.assertTrue(result["countMatches"])
        self.assertEqual(result["status"], "auto-aligned")
        self.assertEqual([cut["bookItems"] for cut in result["sentenceSegments"]], [[1], [2]])

    def test_missing_recognized_boundary_stays_a_visible_mismatch(self):
        items = [{"line": 1, "text": "aaaaazzzzzzz"}, {"line": 2, "text": "yyyyyyybbbbbb"}]
        tokens = [(char, index * .1) for index, char in enumerate("aaaaabbbbbb")]
        result = align(tokens, items, 0, 5, [], 2)
        self.assertEqual(result["expectedSentenceCount"], 2)
        self.assertEqual(len(result["sentenceSegments"]), 1)
        self.assertFalse(result["countMatches"])
        self.assertEqual(result["status"], "needs-review")
        self.assertEqual(result["sentenceSegments"][0]["bookItems"], [1, 2])
        self.assertTrue(result["sentenceSegments"][0]["needsReview"])

    def test_bad_or_incomplete_numbered_text_cannot_pass_automatic_checks(self):
        with self.assertRaises(ValueError):
            align([], [{"line": 1, "text": "Hallo"}, {"line": 3, "text": "Gut"}], 0, 5, [], 2)
        with self.assertRaises(ValueError):
            align([], [{"line": 1, "text": "Hallo"}], 0, 5, [], 2)
        result = align([], [{"line": 1, "text": "Hallo"}], 0, 5, [], 1)
        self.assertFalse(result["countMatches"])
        self.assertEqual(result["expectedSentenceCount"], 1)

    def test_extraction_keeps_wrapped_text_and_excludes_titles_and_pronunciation(self):
        words = [[50, 100, 60, 127, "1"], [50, 170, 60, 197, "2"]]
        def row(text, x, y, size=20):
            return {"text": text, "bbox": [x, y, x + 200, y + 27], "size": size}
        lines = [row("A title", 90, 70), row("1", 50, 100), row("Hallo.", 90, 98),
                 row("Wie geht es dir?", 90, 124), row("2", 50, 170), row("20 Euro, bitte!", 90, 169),
                 row("Pronunciation and notes", 90, 230)]
        result = extract_units(words, lines, [1, 2], 60, 280, 11)
        self.assertEqual([item["text"] for item in result], ["Hallo. Wie geht es dir?", "20 Euro, bitte!"])

    def test_missing_label_requires_review_and_ocr_number_variants_are_recognized(self):
        self.assertEqual(label_number("1s"), 15)
        self.assertEqual(label_number("Io"), 10)
        self.assertIsNone(label_number("Ich"))
        result = extract_units([], [], [1], 0, 100, 11)
        self.assertEqual(result, [{"line": 1, "text": "", "needsReview": True}])


if __name__ == "__main__":
    unittest.main()
