# Prepared Assimil German course

This directory contains lesson titles, page mappings, and audio metadata for the supplied 614-page scan. It does not contain the PDF, lesson dialogue text, recordings, or speech model. Import those files locally on the device; the index lets the study app find the lesson without asking for page numbers or audio choices.

`assimil-german.index.json` is the generated index. `book-layout.json` stores the reviewed crop coordinates and numbered dialogue labels so the scan can be prepared again without repeating OCR or crop selection. `dialogue-label-corrections.json` stores visually checked positions of three labels missing from the scan's text layer. `lesson-titles.json` contains the 100 titles checked visually against the scan, with OCR mistakes and footnote markers removed. Book preprocessing includes these headings in the index.

The completed batch includes 100 recording matches, 100 dialogue ranges, and 1,153 prepared cuts for 1,161 numbered dialogue items. Counts match in 92 lessons. Lessons 9, 32, 35, 43, 45, 80, 84, and 91 each retain one merged pair needing a boundary correction. Automatic timing checks passed for 26 lessons; 160 boundaries across the other 74 lessons are flagged for review. The median agreement between recognized speech and scanned dialogue text is 96.98%. Matching counts and text agreement do not establish timing accuracy. See `coverage.json` for the lesson lists and `lesson-map.csv` for a readable page/audio map.

## Book coverage

- All 100 lessons are mapped. Printed page 1 is PDF page 9.
- The three original PDFs contain a usable text layer. Their hashes identify the exact scan for which the reviewed coordinates apply.
- There are 208 English translation crops. All were visually checked; they exclude German notes, exercise answers, and unrelated cartoon captions.
- Each lesson has German dialogue regions and study page regions. Exercises and review translations that continue above the next lesson heading are included as cropped shared pages.
- `sentenceExcerpts` stores 1,161 coordinate-only crops, one per numbered dialogue item. Boundaries use the scan's actual whitespace because its OCR boxes sometimes overlap adjacent lines. The app displays these excerpts from the user's saved PDF in Shadowing; no transcript or image is included in the hosted files.
- Lesson 57 crosses the split between the first and second PDFs. References include both global and source-local page numbers.
- Review lessons use their review dialogue, with translations sometimes on later or shared pages. Lesson 100 ends before the appendix. The uploaded files do not include the later glossaries listed in the contents.

Page numbers are **1-based**. A crop is `[left, top, right, bottom]` normalized to that individual page. The app accepts the full 614-page book or the three parts. `combined-layout.json` stores hashes and position anchors prepared from every page of the split originals, without publishing book text. On import, a full PDF must match all pages before global references and reviewed crops are enabled. Dimensions, text order, and text positions are checked, tolerating small glyph or punctuation differences. The check uses the existing text layer and saves its result; no OCR runs in the app. PDFs with changed layouts or no usable text layer remain available for custom page settings.

## Audio coverage and pause controls

The audio folder supplied through Drive contains `L001-LESSON.mp3` through `L100-LESSON.mp3`. Filename lesson numbers match automatically; a SHA-256 hash identifies each exact recording. Progress is independent of these media files.

The first six recordings have a repeated reading. Waveform correlation aligns the repeated numbered lines with the initial reading and verifies the order and line count. Later lessons have a single dialogue reading followed by exercises; review recordings contain their review dialogue.

The target is one primary Shadowing cut per **numbered dialogue item in the book**, including items with several grammatical sentences. Preparation extracts those items in order, aligns their text with local speech recognition, and places boundaries using spoken-word timestamps and measured silences. The PDF determines the items, not their timestamps. The index records each cut's `bookItems`, the expected count, text agreement, and uncertain boundaries. `auto-aligned` means automatic checks passed; it is not a manual listening review. `needs-review` identifies cases where OCR, recognition, or a missing pause makes a boundary uncertain. If a boundary cannot be located, its items stay merged and the count mismatch is flagged instead of inventing uniformly spaced cuts.

All timestamps are seconds into the **original MP3**. Use `playStart` and `playEnd` for sentence playback; they add short padding to avoid clipping consonants. Play starts at the current playhead and continues freely. Repeat seeks to the selected cut's start and pauses at its end; scrubbing never selects another cut. This uses the prepared cuts without decoding waveforms or loading a speech model. For whole-lesson playback the app starts at zero, including the spoken lesson number and title, and ends at the prepared dialogue boundary before exercises. Blind listening extends through `repeatDialogue` when present, so a single listen includes both recorded readings.

The app compares the active cut count with the book's expected count, including when saved custom timings are active. Missing or extra cuts show a warning. Users can edit, add, or split cuts; intentional extra splits are allowed. Saved custom timings take priority over regenerated defaults and are never automatically replaced. The timing editor saves corrections to the current cut without changing its neighbors; remaining draft flags are preserved, including in backups.

## Run preprocessing on a laptop

Install Python and FFmpeg, then install the separate preprocessing dependencies:

```sh
python -m pip install -r scripts/requirements-preprocess.txt
python scripts/preprocess_book.py 001-300.pdf 301-600.pdf 601-614.pdf \
  --alignment-text work/numbered-dialogue.json
python scripts/prepare_sentence_excerpts.py 001-300.pdf 301-600.pdf 601-614.pdf
python scripts/preprocess_audio.py /path/to/audio-folder
python scripts/check_course.py
node scripts/prepare_combined_layout.mjs 001-300.pdf 301-600.pdf 601-614.pdf
```

The audio input can also be the full ZIP:

```sh
python scripts/preprocess_audio.py /path/to/all-audio.zip
```

ZIP entries stream into a single temporary MP3 at a time. Nested archive paths are not extracted, originals are preserved, and completed recordings are saved incrementally. Multiple folders, ZIP batches, and individual MP3s can be passed in one command. Identical imports are skipped; different recordings with the same lesson number are reported as conflicts. `--replace` explicitly replaces such a recording. `--force` reruns analysis.

For sentence alignment, additionally install `sherpa-onnx` and download the official [multilingual NeMo CTC model](https://github.com/k2-fsa/sherpa-onnx/blob/master/dart-api-examples/non-streaming-asr/run-nemo-ctc.sh), which supports German. Keep `model.onnx` and `tokens.txt` in a local model directory:

```sh
python -m pip install sherpa-onnx
python scripts/preprocess_audio.py /path/to/audio-folder --force \
  --asr-model /path/to/model-directory --book-text work/numbered-dialogue.json
```

`--alignment-text` writes private lists of `{line, text}` items per lesson. Their numbering must cover every item in the book. To regenerate only sentence cuts while retaining exact recording fingerprints, dialogue ends, titles, and repeated-reading ranges, use:

```sh
python scripts/preprocess_audio.py /path/to/audio-folder --force --alignment-only \
  --asr-model /path/to/model-directory --book-text work/numbered-dialogue.json
python -m unittest discover -s tests -p 'test_*.py'
```

The model runs locally during preparation. It is not part of the PWA. Private OCR text, model files, recordings, and analysis scratch files belong under ignored `work/` or outside this repository. `--report` selects a local processing report; `--output` writes a separate index and merges later batches into it.

Optional `preprocess_book.py --export-pages work/pages` exports WebP pages for a future private import pack. After rebuilding book mappings, rerun `prepare_combined_layout.mjs` with the exact three prepared PDFs to regenerate the full-book profile and its index signature. This script uses the bundled PDF.js and hash code and needs no Node dependencies. The PWA now loads a copy of this index from `dist/course-index.json`, cached with its app shell. After changing prepared data, copy the reviewed index there and publish a versioned app release.
