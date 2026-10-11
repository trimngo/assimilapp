# Prepared Assimil German course

This directory contains page and audio metadata for the supplied 614-page scan. It does not contain the PDF, book text, recordings, or speech model. Import those files locally on the device; the index lets the study app find the lesson without asking for page numbers or audio choices.

`assimil-german.index.json` is the generated index. `book-layout.json` stores the reviewed crop coordinates so the scan can be prepared again without repeating OCR or crop selection.

The completed batch includes 100 recording matches, 100 dialogue ranges, and 1,296 draft sentence segments. Automatic sentence checks passed for 22 lessons; 215 boundaries across the other 78 lessons are flagged for review. The median agreement between recognized speech and scanned dialogue text is 96.99%. This measures text matching, not timing accuracy. See `coverage.json` for the lesson lists and `lesson-map.csv` for a readable page/audio map.

## Book coverage

- All 100 lessons are mapped. Printed page 1 is PDF page 9.
- The three original PDFs contain a usable text layer. Their hashes identify the exact scan for which the reviewed coordinates apply.
- There are 208 English translation crops. All were visually checked; they exclude German notes, exercise answers, and unrelated cartoon captions.
- Each lesson has German dialogue regions and study page regions. Exercises and review translations that continue above the next lesson heading are included as cropped shared pages.
- Lesson 57 crosses the split between the first and second PDFs. References include both global and source-local page numbers.
- Review lessons use their review dialogue, with translations sometimes on later or shared pages. Lesson 100 ends before the appendix. The uploaded files do not include the later glossaries listed in the contents.

Page numbers are **1-based**. A crop is `[left, top, right, bottom]` normalized to that individual page. The original combined PDF needs its page layout verified before these references are applied to it. A recompressed PDF can also change its identity or coordinates; it should be checked before importing as this prepared edition.

## Audio coverage and pause controls

The audio folder supplied through Drive contains `L001-LESSON.mp3` through `L100-LESSON.mp3`. Filename lesson numbers match automatically; a SHA-256 hash identifies each exact recording. Progress is independent of these media files.

The first six recordings have a repeated reading. Waveform correlation aligns the repeated numbered lines with the initial reading and verifies the order and line count. Later lessons have a single dialogue reading followed by exercises; review recordings contain their review dialogue.

Sentence timing uses local speech recognition, punctuation from the scanned book, and measured audio silences. The index records text agreement and uncertain boundaries. `auto-aligned` means automatic checks passed; it is not a manual listening review. `needs-review` identifies cases where OCR, recognition, or a missing pause makes a boundary uncertain. Keep these states distinct when using the index. If a numbered line contains several sentences, its verified line timing alone does not establish the internal sentence cuts.

All timestamps are seconds into the **original MP3**. Use `playStart` and `playEnd` for playback; they add short padding to avoid clipping consonants. The app can seek to a segment, pause at its end, and offer Repeat / Next without decoding waveforms or loading a speech model. Dialogue ranges allow blind listening and read-along to avoid the exercise section.

## Run preprocessing on a laptop

Install Python and FFmpeg, then install the separate preprocessing dependencies:

```sh
python -m pip install -r scripts/requirements-preprocess.txt
python scripts/preprocess_book.py 001-300.pdf 301-600.pdf 601-614.pdf \
  --alignment-text work/german-text.json
python scripts/preprocess_audio.py /path/to/audio-folder
python scripts/check_course.py
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
  --asr-model /path/to/model-directory --book-text work/german-text.json
```

The model runs locally during preparation. It is not part of the PWA. Private OCR text, model files, recordings, and analysis scratch files belong under ignored `work/` or outside this repository. `--report` selects a local processing report; `--output` writes a separate index and merges later batches into it.

Optional `preprocess_book.py --export-pages work/pages` exports WebP pages for a future private import pack. Preparing metadata alone does not install a new PWA release; application integration is a separate change.
