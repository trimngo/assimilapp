#!/usr/bin/env python3
"""Match local recordings and prepare pause timings outside the phone app."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from scipy.signal import correlate

ROOT = Path(__file__).resolve().parents[1]
RATE = 16000
NAME = re.compile(r"^(?:L|Lesson[\s_-]*)(\d{1,3})(?:[-_ ](LESSON|EXERCISE))?\.mp3$", re.I)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def probe(path):
    raw = subprocess.check_output(["ffprobe", "-v", "quiet", "-show_format", "-of", "json", str(path)])
    return json.loads(raw)["format"]


def silences(path, duration):
    run = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-map", "0:a:0",
                          "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=True)
    result, start = [], None
    for kind, value in re.findall(r"silence_(start|end): ([0-9.]+)", run.stderr):
        if kind == "start":
            start = float(value)
        elif start is not None:
            result.append((start, float(value)))
            start = None
    if start is not None:
        result.append((start, duration))
    return result


def pcm(path):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
                                   "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                                  stderr=subprocess.DEVNULL)
    return np.frombuffer(raw, dtype="<f4").astype("float64")


def match(first, template, energy):
    size = len(template)
    if size < RATE // 5 or size > len(first):
        return None
    corr = correlate(first, template, mode="valid", method="fft")
    denom = np.sqrt(np.maximum(0, energy[size:] - energy[:-size]) * np.dot(template, template))
    score = np.divide(corr, denom, out=np.zeros_like(corr), where=denom > 1e-10)
    peak = int(np.argmax(score))
    return peak / RATE, (peak + size) / RATE, float(score[peak])


def repeated_alignment(samples, pauses, count):
    # The supplied normal recordings read the dialogue, then repeat each numbered line.
    # Try alternate gap thresholds; accept only a complete, ordered waveform match.
    for threshold in (2.7, 3.2, 2.3, 1.7):
        major = [(a, b) for a, b in pauses if b - a > threshold]
        for offset in range(min(10, max(0, len(major) - count))):
            first_end, repeat_start = major[offset]
            first = samples[:round(first_end * RATE)]
            energy = np.concatenate(([0.0], np.cumsum(first ** 2)))
            repeated, cursor = [], repeat_start
            for a, b in major[offset + 1:offset + count + 1]:
                repeated.append((cursor, a))
                cursor = b
            if len(repeated) != count:
                continue
            result = []
            for a, b in repeated:
                matched = match(first, samples[round(a * RATE):round(b * RATE)], energy)
                if matched is None:
                    break
                start, end, similarity = matched
                if similarity < 0.97 or (result and start < result[-1]["end"]):
                    break
                result.append({"line": len(result) + 1, "start": round(start, 4),
                               "end": round(end, 4), "repeatStart": round(a, 4),
                               "repeatEnd": round(b, 4), "repeatSimilarity": round(similarity, 5)})
            if len(result) == count:
                return result
    return None


def dialogue_bounds(pauses, duration, review):
    # Header and title are followed by ~2-second silences. Exercises have a
    # long lead-in, a short announcement, another ~2-second pause, then instructions.
    introductory = [(a, b) for a, b in pauses if b - a > 1.7 and b < 25]
    if len(introductory) < 2 and introductory:
        after_header = [(a, b) for a, b in pauses if a > introductory[0][1] and b - a > 1.2 and b < 25]
        if after_header:
            introductory.append(after_header[0])
    if len(introductory) < 2:
        return None
    start = introductory[1][1]
    if review:
        terminal = [(a, b) for a, b in pauses if b > duration - 0.2 and b - a > 2.7]
        return (start, terminal[-1][0]) if terminal else None
    transitions = []
    for i, (a, b) in enumerate(pauses[:-2]):
        c, d = pauses[i + 1]
        after_instruction = [(e, f) for e, f in pauses[i + 2:] if e - d < 15 and f - e > 2.7]
        if a > start and b - a > 2.7 and 0.05 < c - b < 1.5 and 1.7 < d - c < 2.4 and after_instruction:
            transitions.append(a)
    return (start, transitions[0]) if transitions else None


def speech_groups(pauses, duration, threshold):
    groups, cursor = [], 0.0
    for start, end in pauses:
        if end - start < threshold:
            continue
        if start - cursor >= 0.2:
            groups.append([round(cursor, 4), round(start, 4)])
        cursor = end
    if duration - cursor >= 0.2:
        groups.append([round(cursor, 4), round(duration, 4)])
    return groups


def playback_padding(phrases, duration):
    for i, phrase in enumerate(phrases):
        previous_end = phrases[i - 1]["end"] if i else 0
        next_start = phrases[i + 1]["start"] if i + 1 < len(phrases) else duration
        phrase["playStart"] = round(max(previous_end, phrase["start"] - 0.06), 4)
        phrase["playEnd"] = round(min(next_start, phrase["end"] + 0.10), 4)


def analyze(path, lesson, recognizer=None, book_text=None):
    info = probe(path)
    duration = float(info["duration"])
    pauses = silences(path, duration)
    samples = pcm(path)
    phrases = repeated_alignment(samples, pauses, lesson["numberedLineCount"]) if lesson["number"] <= 6 else None
    audio = {"filename": path.name, "bytes": path.stat().st_size, "sha256": digest(path),
             "duration": round(duration, 6), "matchMethod": "lesson-number-in-filename",
             "analysisVersion": 2}
    if phrases:
        playback_padding(phrases, duration)
        audio.update({"status": "aligned-numbered-lines", "alignmentMethod": "repeat-waveform-correlation",
                      "numberedLines": phrases,
                      "dialogue": {"start": phrases[0]["playStart"], "end": phrases[-1]["playEnd"]},
                      "repeatDialogue": {"start": phrases[0]["repeatStart"], "end": phrases[-1]["repeatEnd"]},
                      "sentenceStatus": "numbered-lines-only"})
        # Natural pauses within a numbered line are candidates, never asserted sentences.
        audio["internalPauseCandidates"] = [
            {"line": p["line"], "start": round(a, 4), "end": round(b, 4), "status": "needs-review"}
            for p in phrases for a, b in pauses if p["start"] < a < b < p["end"]]
    else:
        bounds = dialogue_bounds(pauses, duration, lesson["kind"] == "review")
        audio.update({"status": "needs-review", "sentenceStatus": "needs-review",
                      "reason": "Could not verify a complete repeated-line alignment",
                      "candidateSpeechGroups": speech_groups(pauses, duration, 0.6)})
        if bounds:
            start, end = bounds
            local_pauses = [(a, b) for a, b in pauses if start < a < b < end]
            groups, cursor = [], start
            for a, b in local_pauses:
                if b - a >= 0.8:
                    groups.append({"start": round(cursor, 4), "end": round(a, 4), "status": "needs-review"})
                    cursor = b
            groups.append({"start": round(cursor, 4), "end": round(end, 4), "status": "needs-review"})
            playback_padding(groups, duration)
            audio.update({"dialogue": {"start": round(start, 4), "end": round(end, 4)},
                          "dialogueBoundaryMethod": "header-title-and-exercise-pause-pattern",
                          "pauseCandidates": groups,
                          "reason": "Single dialogue reading; sentence candidates require listening review"})
    if recognizer and book_text and audio.get("dialogue"):
        from sentence_alignment import align, recognize
        start, end = audio["dialogue"]["start"], audio["dialogue"]["end"]
        tokens = recognize(recognizer, samples, start, end, pauses)
        aligned = align(tokens, book_text, start, end, pauses)
        if aligned.get("sentenceSegments"):
            playback_padding(aligned["sentenceSegments"], duration)
        audio["sentenceAlignment"] = aligned
        if aligned.get("sentenceSegments"):
            audio.pop("candidateSpeechGroups", None)
            audio.pop("pauseCandidates", None)
        audio["sentenceStatus"] = aligned["status"]
        if lesson["number"] <= 3 and phrases and aligned.get("expectedSentenceCount") == len(phrases):
            # These three source dialogues have one sentence per numbered line.
            # Their independently verified waveform timings provide stronger endpoints.
            aligned.update({"status": "auto-aligned", "method": "verified-numbered-line-sentences",
                            "uncertainBoundaries": [], "sentenceSegments": [
                                {"sentence": p["line"], "start": p["start"], "end": p["end"],
                                 "playStart": p["playStart"], "playEnd": p["playEnd"],
                                 "method": "repeat-waveform-correlation", "needsReview": False} for p in phrases]})
            audio["sentenceStatus"] = "auto-aligned"
        if aligned["status"] == "auto-aligned" and audio["status"] == "needs-review":
            audio["status"] = "aligned-sentences"
    return audio


def recordings(paths):
    """Stream ZIP members into one temporary file at a time; never extract their paths."""
    for path in paths:
        if path.is_dir():
            yield from ((p, p.name) for p in sorted(path.rglob("*.mp3"), key=lambda p: p.name))
        elif zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive, tempfile.TemporaryDirectory(prefix="assimil-audio-") as temp:
                for member in sorted(archive.infolist(), key=lambda m: m.filename):
                    name = Path(member.filename).name
                    if member.is_dir() or name.startswith("._") or not name.lower().endswith(".mp3"):
                        continue
                    if member.file_size > 64 * 1024 * 1024:
                        raise ValueError(f"Oversized audio entry: {name}")
                    target = Path(temp) / "recording.mp3"
                    with archive.open(member) as source, target.open("wb") as dest:
                        shutil.copyfileobj(source, dest, length=1024 * 1024)
                    yield target, name
                    target.unlink()
        elif path.suffix.lower() == ".mp3":
            yield path, path.name
        else:
            raise ValueError(f"Expected an audio folder, ZIP, or MP3: {path}")


def save(index, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(index, indent=2) + "\n")
    temporary.replace(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", type=Path, nargs="+", help="Audio folders, ZIPs, or MP3 files")
    parser.add_argument("--index", type=Path, default=ROOT / "course/assimil-german.index.json")
    parser.add_argument("--output", type=Path, help="Defaults to updating --index; supports incremental batches")
    parser.add_argument("--report", type=Path, default=ROOT / "work/audio-report.json")
    parser.add_argument("--replace", action="store_true", help="Explicitly replace a different recording of a lesson")
    parser.add_argument("--force", action="store_true", help="Reanalyze an unchanged recording")
    parser.add_argument("--asr-model", type=Path, help="Optional local NeMo CTC model directory with model.onnx and tokens.txt")
    parser.add_argument("--book-text", type=Path, help="Private OCR text produced by preprocess_book.py --alignment-text")
    args = parser.parse_args()
    recognizer, book_text = None, {}
    if args.asr_model:
        if not args.book_text:
            parser.error("--asr-model requires --book-text")
        import sherpa_onnx
        recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(args.asr_model / "model.onnx"), tokens=str(args.asr_model / "tokens.txt"), num_threads=3)
        book_text = json.loads(args.book_text.read_text())
    for command in ("ffmpeg", "ffprobe"):
        if not shutil.which(command):
            parser.error(f"Install {command} first")
    output = args.output or args.index
    # Merge earlier output batches when --output is separate from the base index.
    index = json.loads((output if output.exists() else args.index).read_text())
    lessons = {l["number"]: l for l in index["lessons"]}
    report = {"processed": [], "skipped": [], "unmatched": [], "conflicts": [], "errors": []}
    for path, name in recordings(args.inputs):
        found = NAME.fullmatch(name)
        if not found or int(found[1]) not in lessons or (found[2] or "LESSON").upper() != "LESSON":
            report["unmatched"].append(name)
            continue
        number = int(found[1])
        lesson = lessons[number]
        identity = digest(path)
        existing = lesson.get("audio")
        if existing and existing.get("sha256") != identity and not args.replace:
            report["conflicts"].append({"filename": name, "lesson": number})
            continue
        if existing and existing.get("sha256") == identity and not args.force:
            report["skipped"].append(name)
            continue
        try:
            audio = analyze(path, lesson, recognizer, book_text.get(str(number)))
            audio["filename"] = name
            lesson["audio"] = audio
            save(index, output)  # Each completed recording survives interruption.
            report["processed"].append({"filename": name, "lesson": number, "status": audio["status"]})
            print(f"{name}: {audio['status']}", flush=True)
        except (ValueError, subprocess.CalledProcessError, OSError) as error:
            report["errors"].append({"filename": name, "error": str(error)})
            print(f"{name}: failed ({error})", flush=True)
    report["missingLessons"] = [n for n, l in lessons.items() if not l.get("audio")]
    report["needsReview"] = [n for n, l in lessons.items() if l.get("audio", {}).get("status") == "needs-review"]
    report["alignedLessons"] = [n for n, l in lessons.items() if l.get("audio", {}).get("status") == "aligned-numbered-lines"]
    report["sentenceAlignedLessons"] = [n for n, l in lessons.items() if l.get("audio", {}).get("sentenceStatus") == "auto-aligned"]
    report["sentenceNeedsReview"] = [n for n, l in lessons.items() if l.get("audio", {}).get("sentenceStatus") == "needs-review"]
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    save(index, output)
    print(f"Aligned {len(report['alignedLessons'])}; review {len(report['needsReview'])}; missing {len(report['missingLessons'])}")
    if report["errors"] or report["conflicts"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
