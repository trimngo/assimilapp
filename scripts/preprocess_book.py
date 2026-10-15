#!/usr/bin/env python3
"""Build metadata for the reviewed scan; PDFs and rendered pages stay local."""
import argparse
import hashlib
import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ("001-300.pdf", 300, "dce76e0d5688ec7e3dc438ca43a0059ebb55140d13d7350e7770d36a07970b6b"),
    ("301-600.pdf", 300, "4f7adc01adffa6b4bfa877c8e51326ea306edf141c4a9baf1efa6c0743415de2"),
    ("601-614.pdf", 14, "ff34e06a6336851856813398561974fed537a189d9762002b635baca2b2313f5"),
]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def lines(page):
    result = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if spans:
                result.append({"text": "".join(s["text"] for s in spans),
                               "bbox": line["bbox"], "size": max(s["size"] for s in spans)})
    return result


def heading(page, english=False):
    pattern = r"\blesson\b" if english else r"\bLektion\b"
    matches = [line for line in lines(page) if line["size"] > 21
               and re.search(pattern, line["text"], re.I)]
    if len(matches) != 1:
        raise ValueError("Expected one lesson heading on its opening page")
    return matches[0]


def build(pdf_paths, output, export_dir=None, alignment_text=None):
    layout = json.loads((ROOT / "course/book-layout.json").read_text())
    # Reviewed against the scan; its OCR confuses umlauts and footnote markers.
    titles = json.loads((ROOT / "course/lesson-titles.json").read_text())
    if len(titles) != 100 or any(not isinstance(title, str) or not title.strip() for title in titles):
        raise ValueError("Expected 100 reviewed lesson titles")
    sources, pages, documents = [], [], []
    # Validate the exact originals before applying edition-specific crops.
    for path, (name, count, expected_hash) in zip(pdf_paths, SOURCES):
        actual_hash = sha256(path)
        if actual_hash != expected_hash:
            raise ValueError(f"{path.name}: this PDF differs from the reviewed scan")
        doc = fitz.open(path)
        documents.append(doc)  # Keep parents alive while their Page objects are used.
        if len(doc) != count:
            raise ValueError(f"{path.name}: expected {count} pages")
        sources.append({"id": name, "filename": name, "pageCount": count,
                        "firstGlobalPage": len(pages) + 1, "bytes": path.stat().st_size,
                        "sha256": actual_hash})
        pages.extend((name, local + 1, doc[local]) for local in range(count))

    def ref(number, box=None):
        source, local, page = pages[number - 1]
        value = {"globalPage": number, "sourceId": source, "sourcePage": local}
        if box is not None:
            x0, y0, x1, y1 = box
            x0, x1 = max(0, x0), min(page.rect.width, x1)
            y0, y1 = max(0, y0), min(page.rect.height, y1)
            if not (x0 < x1 and y0 < y1):
                raise ValueError(f"Invalid crop for page {number}")
            value["crop"] = [round(x0 / page.rect.width, 6), round(y0 / page.rect.height, 6),
                             round(x1 / page.rect.width, 6), round(y1 / page.rect.height, 6)]
        return value

    starts = layout["lessonStartPages"]
    cuts = {}
    for number, start in enumerate(starts, 1):
        german = heading(pages[start - 1][2])
        words = pages[start - 1][2].get_text("words")
        labels = [w for w in words if w[4] == str(number) and w[0] < 110
                  and abs(w[1] - german["bbox"][1]) < 7 and w[3] - w[1] > 29]
        if not labels:
            raise ValueError(f"Lesson {number}: heading number did not verify")
        for offset in (0, 1):
            h = heading(pages[start + offset - 1][2], english=bool(offset))
            cuts[start + offset] = max(0, h["bbox"][1] - 9) if h["bbox"][1] > 75 else 0

    previous = json.loads(output.read_text()) if output.exists() else {}
    old_audio = {l["number"]: l.get("audio") for l in previous.get("lessons", [])}
    old_excerpts = {l["number"]: l.get("sentenceExcerpts") for l in previous.get("lessons", [])}
    lessons = []
    for number, start in enumerate(starts, 1):
        end = starts[number] - 1 if number < 100 else 572
        study = []
        for pg in range(start, end + 1):
            page = pages[pg - 1][2]
            top = cuts.get(pg, 0) if pg in (start, start + 1) else 0
            study.append(ref(pg, [0, top, page.rect.width, page.rect.height]))
        # Notes, exercises, and review translations sometimes precede the next heading.
        if number < 100:
            for pg in (end + 1, end + 2):
                if cuts[pg] > 0:
                    page = pages[pg - 1][2]
                    study.append(ref(pg, [0, 0, page.rect.width, cuts[pg]]))
        recall = [ref(r["page"], r["box"]) for r in layout["recall"] if r["lesson"] == number]
        dialogue = []
        for r in layout["dialogue"]:
            if r["lesson"] == number:
                dialogue.append({**ref(r["page"], r["box"]), "numberedLines": r["numberedLines"]})
        if not recall:
            raise ValueError(f"Lesson {number}: missing English recall crop")
        lesson = {"number": number, "title": titles[number - 1], "kind": "review" if number % 7 == 0 else "lesson",
                  "startGlobalPage": start, "startPrintedPage": start - 8,
                  "studyPages": study, "germanDialogue": dialogue, "englishRecall": recall,
                  "numberedLineCount": layout["numberedLineCounts"][number - 1],
                  "expectedAudioFilename": f"L{number:03d}-LESSON.mp3"}
        if old_audio.get(number):
            lesson["audio"] = old_audio[number]
        if old_excerpts.get(number):
            lesson["sentenceExcerpts"] = old_excerpts[number]
        lessons.append(lesson)
    index = {"schemaVersion": 1, "courseId": "assimil-german-supplied-scan-614",
             "book": {"title": "Assimil German", "pageCount": 614, "printedPageOffset": 8,
                      "lessonCount": 100, "sources": sources,
                      "cropCoordinates": "normalized [left, top, right, bottom]; all page numbers are 1-based",
                      "recallReview": "All 208 translation crops visually checked against supplied scan"},
             "lessons": lessons}
    if previous.get("book", {}).get("combinedLayoutSignature"):
        index["book"]["combinedLayoutSignature"] = previous["book"]["combinedLayoutSignature"]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(index, indent=2) + "\n")
    if alignment_text:
        from dialogue_units import extract_units
        corrections = json.loads((ROOT / "course/dialogue-label-corrections.json").read_text())["pages"]
        private = {}
        for lesson in lessons:
            items = []
            for region in layout["dialogue"]:
                if region["lesson"] != lesson["number"]:
                    continue
                page = pages[region["page"] - 1][2]
                items.extend(extract_units(page.get_text("words"), lines(page), region["numberedLines"],
                                           region["box"][1], region["box"][3], lesson["number"],
                                           corrections.get(str(region["page"]))))
            if [item["line"] for item in items] != list(range(1, lesson["numberedLineCount"] + 1)):
                raise ValueError(f"Lesson {lesson['number']}: dialogue labels must cover every numbered item")
            if lesson["number"] == 7:
                for item in items:
                    item["text"] = item["text"].replace("Guten Tagt", "Guten Tag!")
            private[str(lesson["number"])] = items
        alignment_text.parent.mkdir(parents=True, exist_ok=True)
        alignment_text.write_text(json.dumps(private, ensure_ascii=False, indent=2) + "\n")
    if export_dir:
        # Optional private assets for a later import pack. Nothing is uploaded.
        export_dir.mkdir(parents=True, exist_ok=True)
        for pg in range(9, 573):
            page = pages[pg - 1][2]
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            pix.pil_save(str(export_dir / f"page-{pg:03d}.webp"), format="WEBP", quality=82)
    print(f"Saved {output}: 100 lessons, 208 English recall crops")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdfs", type=Path, nargs=3, help="The three original PDFs in page order")
    parser.add_argument("--output", type=Path, default=ROOT / "course/assimil-german.index.json")
    parser.add_argument("--export-pages", type=Path, help="Optional local WebP page export directory")
    parser.add_argument("--alignment-text", type=Path, help="Private OCR text for optional local speech alignment; keep outside git")
    args = parser.parse_args()
    build(args.pdfs, args.output, args.export_pages, args.alignment_text)


if __name__ == "__main__":
    main()
