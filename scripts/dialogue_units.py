"""Extract numbered dialogue units; OCR text stays in private preparation output."""
import re
import statistics


def label_number(value):
    value = value.strip("-–=., ")
    value = value.translate(str.maketrans({"l": "1", "I": "1", "o": "0", "O": "0", "s": "5", "S": "5"}))
    return int(value) if value.isdigit() else None


def extract_units(words, text_lines, expected, top, bottom, lesson, corrections=None):
    candidates = [(label_number(w[4]), w) for w in words
                  if label_number(w[4]) in expected and 20 < w[0] < 160
                  and w[3] - w[1] > 15 and top - 1 <= w[1] < bottom
                  and not (w[0] < 80 and w[1] < 60 and label_number(w[4]) == lesson)]
    column = statistics.median(w[0] for _, w in candidates) if candidates else 80
    selected = {}
    for number, word in candidates:
        if abs(word[0] - column) < 22 and (number not in selected or word[1] < selected[number][1]):
            selected[number] = word
    # Only reviewed missing labels are supplied here, never guessed timing cuts.
    for correction in corrections or []:
        if correction["line"] in expected:
            x, y = correction["x"], correction["y"]
            selected[correction["line"]] = [x, y, x + 12, y + 27, str(correction["line"])]
    if not selected:
        return [{"line": number, "text": "", "needsReview": True} for number in expected]
    body = [line for line in text_lines if line["size"] >= 17 and top - 1 <= line["bbox"][1] < bottom]
    first = min(w[1] for w in selected.values()) - 14
    tail = max(w[3] for w in selected.values())
    for line in sorted(body, key=lambda item: item["bbox"][1]):
        if line["bbox"][1] < first:
            continue
        if line["bbox"][1] > tail + 12:
            break
        tail = max(tail, line["bbox"][3])
    output = []
    for number in expected:
        word = selected.get(number)
        if word is None:
            output.append({"line": number, "text": "", "needsReview": True})
            continue
        center = (word[1] + word[3]) / 2
        following = [(w[1] + w[3]) / 2 for n, w in selected.items() if n > number]
        end = min(following) - 12 if following else tail + 2
        parts = []
        for line in sorted(body, key=lambda item: (item["bbox"][1], item["bbox"][0])):
            row = (line["bbox"][1] + line["bbox"][3]) / 2
            if center - 12 <= row < end:
                value = line["text"]
                if line["bbox"][0] < word[0] + 15:
                    while True:
                        prefix = re.match(r"^\s*([^\s]+)(?:\s+|$)", value)
                        if not prefix or label_number(prefix[1]) not in {number, lesson}:
                            break
                        value = value[prefix.end():].lstrip(" -–=")
                value = re.sub(r"\b(?:CD|CT|CZ)\b\)?", "", value)
                value = re.sub(r"[®@►□]", "", value).strip()
                if value and value != "***":
                    parts.append(value)
        text = " ".join(parts)
        output.append({"line": number, "text": text, **({"needsReview": True} if not text else {})})
    return output
