#!/usr/bin/env python3
"""Validate page references and playable timing ranges in a prepared course index."""
import argparse
import json
from pathlib import Path


def check(index):
    lessons = index["lessons"]
    assert [l["number"] for l in lessons] == list(range(1, 101)), "Expected 100 ordered lessons"
    sources = {s["id"]: s for s in index["book"]["sources"]}
    assert sum(s["pageCount"] for s in sources.values()) == 614
    assert sum(len(l["englishRecall"]) for l in lessons) == 208
    for lesson in lessons:
        assert lesson["englishRecall"] and lesson["germanDialogue"]
        assert lesson["startPrintedPage"] == lesson["startGlobalPage"] - 8
        for key in ("studyPages", "germanDialogue", "englishRecall"):
            for page in lesson[key]:
                source = sources[page["sourceId"]]
                assert 1 <= page["sourcePage"] <= source["pageCount"]
                assert page["globalPage"] == source["firstGlobalPage"] + page["sourcePage"] - 1
                if "crop" in page:
                    x0, y0, x1, y1 = page["crop"]
                    assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
        audio = lesson.get("audio")
        if not audio:
            continue
        assert audio["filename"] == lesson["expectedAudioFilename"]
        assert len(audio["sha256"]) == 64 and audio["bytes"] > 0
        duration = audio["duration"]
        if audio.get("dialogue"):
            assert 0 <= audio["dialogue"]["start"] < audio["dialogue"]["end"] <= duration
        numbered = audio.get("numberedLines", [])
        if numbered:
            assert len(numbered) == lesson["numberedLineCount"]
            assert [p["line"] for p in numbered] == list(range(1, len(numbered) + 1))
            assert all(p["repeatSimilarity"] >= 0.97 for p in numbered)
        sentences = audio.get("sentenceAlignment", {}).get("sentenceSegments", [])
        for phrases in (numbered, sentences, audio.get("pauseCandidates", [])):
            last_end = 0
            for phrase in phrases:
                assert last_end <= phrase["start"] < phrase["end"] <= duration
                assert 0 <= phrase["playStart"] <= phrase["start"] < phrase["end"] <= phrase["playEnd"] <= duration
                last_end = phrase["end"]
    # Regression checks for a shared exercise spread and a lesson across the PDF split.
    assert [p["globalPage"] for p in lessons[1]["studyPages"]] == [13, 14, 15, 16]
    assert len({p["sourceId"] for p in lessons[56]["studyPages"]}) == 2
    assert lessons[99]["startGlobalPage"] == 565
    # Independent waveform matches established on the originally supplied recordings.
    golden = {
        1: [(6.3444, 7.4384), (8.5901, 11.1714), (12.3023, 13.0950), (14.1889, 16.4125), (17.4883, 20.2388)],
        2: [(6.9806, 8.3631), (9.4607, 11.0076), (12.1161, 13.8330), (14.4392, 15.7788), (16.8599, 18.6472)],
        3: [(6.0561, 7.1360), (8.2140, 11.0420), (12.1219, 14.1832), (15.2673, 17.6976), (18.7569, 20.6641), (21.7506, 26.1399)],
    }
    for number, expected in golden.items():
        actual = lessons[number - 1].get("audio", {}).get("numberedLines")
        if actual:
            assert len(actual) == len(expected)
            assert all(abs(p["start"] - start) < 0.003 and abs(p["end"] - end) < 0.003
                       for p, (start, end) in zip(actual, expected)), f"Lesson {number}: timing changed"
    print("Validated 100 lessons, 208 recall crops, shared pages, split references, and audio timing ranges")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path, nargs="?", default=Path(__file__).resolve().parents[1] / "course/assimil-german.index.json")
    check(json.loads(parser.parse_args().index.read_text()))
