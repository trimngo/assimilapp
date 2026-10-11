"""Optional local ASR alignment. The exported index contains timings, not transcripts."""
import difflib
import re
import unicodedata

import numpy as np


def normalized(text):
    text = text.lower().replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFKD", text)
                   if c.isalnum() and not unicodedata.combining(c))


def recognize(recognizer, samples, start, end, pauses, rate=16000):
    tokens = []
    cursor = start
    while cursor < end - 0.1:
        stop = min(end, cursor + 30)
        if stop < end:
            choices = [(a + b) / 2 for a, b in pauses if cursor + 18 < a < b < stop and b - a > 0.4]
            if choices:
                stop = max(choices)
        stream = recognizer.create_stream()
        stream.accept_waveform(rate, samples[round(cursor * rate):round(stop * rate)].astype(np.float32))
        recognizer.decode_stream(stream)
        result = stream.result
        tokens.extend((token, cursor + float(timestamp)) for token, timestamp in zip(result.tokens, result.timestamps))
        cursor = stop
    return tokens


def align(tokens, book_text, start, end, pauses):
    chars, times = [], []
    for token, timestamp in tokens:
        for char in normalized(token):
            chars.append(char)
            times.append(timestamp)
    heard = "".join(chars)
    printed = normalized(book_text)
    if not heard or not printed:
        return {"status": "needs-review", "reason": "Empty dialogue text"}
    matcher = difflib.SequenceMatcher(None, printed, heard, autojunk=False)
    mapping = {}
    for a, b, size in matcher.get_matching_blocks():
        mapping.update((a + i, b + i) for i in range(size))
    ratio = matcher.ratio()
    boundaries = sorted(set(len(normalized(book_text[:m.start()]))
                            for m in re.finditer(r"[.!?]+[\"'”»)]*(?=\s|$)", book_text)))
    boundaries = [i for i in boundaries if 0 < i < len(printed)]
    segments, cursor, uncertain = [], start, []
    for boundary in boundaries:
        left = next((i for i in range(boundary - 1, max(-1, boundary - 5), -1) if i in mapping), None)
        right = next((i for i in range(boundary, min(len(printed), boundary + 4)) if i in mapping), None)
        if left is None or right is None:
            uncertain.append({"boundary": boundary, "reason": "Sentence ending not recognized"})
            continue
        before, after = times[mapping[left]], times[mapping[right]]
        candidates = [(a, b) for a, b in pauses if before - 0.40 < a < b < after + 0.40 and b - a >= 0.25]
        if candidates:
            stop, resume = max(candidates, key=lambda p: p[1] - p[0])
            method = "book-punctuation-and-audio-silence"
        else:
            stop = resume = (before + after) / 2
            method = "token-midpoint"
        if not cursor < stop < end or resume >= end:
            uncertain.append({"boundary": boundary, "reason": "Invalid or repeated boundary"})
            continue
        exact = boundary - 1 - left <= 1 and right - boundary <= 1
        needs_review = not exact or method == "token-midpoint"
        if needs_review:
            uncertain.append({"boundary": boundary, "reason": "Approximate word ending"})
        segments.append({"sentence": len(segments) + 1, "start": round(cursor, 4),
                         "end": round(stop, 4), "method": method, "needsReview": needs_review})
        cursor = resume
    segments.append({"sentence": len(segments) + 1, "start": round(cursor, 4),
                     "end": round(end, 4), "method": "dialogue-end", "needsReview": False})
    complete = len(segments) == len(boundaries) + 1
    confident = ratio >= 0.90 and complete and not uncertain
    return {"status": "auto-aligned" if confident else "needs-review",
            "method": "local-nemo-ctc-book-punctuation-and-silence",
            "textAgreement": round(ratio, 4), "expectedSentenceCount": len(boundaries) + 1,
            "sentenceSegments": segments, "uncertainBoundaries": uncertain,
            "verification": "automatic; not a manual listening review"}
