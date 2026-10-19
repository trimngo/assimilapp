#!/usr/bin/env python3
"""Prepare English prompt coordinates from the private scan, never publish OCR text."""
import argparse
import json
import re
import statistics
from pathlib import Path

import fitz
import numpy as np
from dialogue_units import label_number
from preprocess_book import sha256

ROOT = Path(__file__).resolve().parents[1]


def reading_order(words):
    rows = []
    for word in sorted(words, key=lambda w: (w[1] + w[3]) / 2):
        center = (word[1] + word[3]) / 2
        if not rows or center - rows[-1][0] > 8:
            rows.append((center, [word]))
        else:
            rows[-1][1].append(word)
    return [word for _, row in rows for word in sorted(row, key=lambda w: w[0])]


def text_rows(page, bounds):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=fitz.Rect(bounds), colorspace=fitz.csGRAY, alpha=False)
    gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    ink = np.flatnonzero((gray < 150).sum(axis=1) > max(3, pix.width * .004))
    runs = np.split(ink, np.where(np.diff(ink) > 3)[0] + 1) if len(ink) else []
    return [(max(bounds[1], (run[0] + pix.y) / 2), min(bounds[3], (run[-1] + 1 + pix.y) / 2))
            for run in runs if len(run) >= 2]


def markers(page, bounds, review, corrections):
    words = [list(w[:5]) for w in page.get_text('words') if bounds[0] <= w[0] < bounds[2]
             and bounds[1] <= (w[1] + w[3]) / 2 <= bounds[3] and w[3] - w[1] > 15]
    candidates = []
    for word in words:
        token = word[4].strip('-–=., ')
        number = int(token) if token.isdigit() else None
        if not review and word[0] < 180:
            number = label_number(token.replace('z', '2').replace('B', '8'))
        if number and (review or word[0] < 180):
            candidates.append([*word[:4], str(number)])
    if not review:
        # OCR can split a two-digit margin label into two adjacent words.
        for first, second in zip(words, words[1:]):
            if first[0] < 160 and 0 <= second[0] - first[2] < 3 and abs((first[1]+first[3])-(second[1]+second[3])) < 16:
                number = label_number(first[4] + second[4])
                if number and number >= 10:
                    candidates.append([first[0], min(first[1],second[1]),second[2],max(first[3],second[3]),str(number)])
        digits = [w[0] for w in candidates if re.fullmatch(r'\d+', next((v[4] for v in words if v[:4] == w[:4]), ''))]
        column = statistics.median(digits) if digits else min((w[0] for w in candidates), default=0)
        candidates = [w for w in candidates if abs(w[0] - column) < 23]
    candidates.extend([c['x'], c['y'], c['x']+10, c['y']+24, str(c['number'])] for c in corrections)
    return reading_order(candidates)


def prepare(paths):
    index = json.loads((ROOT / 'course/assimil-german.index.json').read_text())
    docs = {}
    for path, source in zip(paths, index['book']['sources']):
        if sha256(path) != source['sha256']:
            raise ValueError(f'{path.name}: use the exact prepared PDF.')
        docs[source['id']] = fitz.open(path)
    corrections = json.loads((ROOT / 'course/english-label-corrections.json').read_text())['pages']
    total = 0
    for lesson in index['lessons']:
        regions, labels = [], []
        expected = 1
        review = lesson['kind'] == 'review'
        for ref in lesson['englishRecall']:
            page = docs[ref['sourceId']][ref['sourcePage'] - 1]
            bounds = [value * (page.rect.width if i % 2 == 0 else page.rect.height) for i, value in enumerate(ref['crop'])]
            rows = text_rows(page, bounds)
            if not rows:
                raise ValueError(f"Lesson {lesson['number']}, page {ref['globalPage']}: no text rows")
            region = {'ref': ref, 'page': page, 'bounds': bounds, 'rows': rows}
            regions.append(region)
            for word in markers(page, bounds, review, corrections.get(str(ref['globalPage']), [])):
                if int(word[4]) != expected or expected > lesson['numberedLineCount']:
                    continue
                center = (word[1] + word[3]) / 2
                row = min(range(len(rows)), key=lambda i: abs(sum(rows[i])/2-center))
                labels.append({'number': expected, 'region': len(regions)-1, 'row': row, 'x': word[0]})
                expected += 1
        if expected != lesson['numberedLineCount'] + 1:
            raise ValueError(f"Lesson {lesson['number']}: English labels found only through {expected-1}")
        excerpts = []
        for i, label in enumerate(labels):
            following = labels[i+1] if i+1 < len(labels) else None
            last_region = following['region'] if following else len(regions)-1
            for ri in range(label['region'], last_region+1):
                region = regions[ri];rows = region['rows'];bounds = region['bounds'];page = region['page'];ref = region['ref']
                first = label['row'] if ri == label['region'] else 0
                last = len(rows)-1
                if following and ri == following['region']:
                    # Inline review translations share printed rows. Keep the
                    # full row rather than cutting off either English prompt.
                    left = min(w[0] for w in page.get_text('words') if bounds[0] <= w[0] < bounds[2] and bounds[1] <= (w[1]+w[3])/2 <= bounds[3])
                    last = following['row'] if review and following['x'] > left + 20 else following['row']-1
                    if first > last:
                        if review and ri == label['region'] and label['row'] == following['row']:
                            last = first
                        else:
                            continue
                top = max(bounds[1], rows[first][0]-2)
                bottom = min(bounds[3], rows[last][1]+2)
                entry = {'number': label['number'], 'globalPage': ref['globalPage'], 'sourceId': ref['sourceId'],
                                 'sourcePage': ref['sourcePage'], 'crop': [ref['crop'][0], round(top/page.rect.height,6),ref['crop'][2],round(bottom/page.rect.height,6)]}
                if review:
                    # Preserve the page's scale and alignment, but blank the
                    # neighbouring prompts that share this printed paragraph.
                    body_left = min(w[0] for w in page.get_text('words') if bounds[0] <= w[0] < bounds[2] and bounds[1] <= (w[1]+w[3])/2 <= bounds[3])
                    bands = []
                    for row in range(first,last+1):
                        left = max(bounds[0],body_left-2,label['x']-2 if ri==label['region'] and row==label['row'] else 0)
                        right = min(bounds[2],following['x']-2) if following and ri==following['region'] and row==following['row'] else bounds[2]
                        upper = max(top,(rows[row-1][1]+rows[row][0])/2 if row else top)
                        lower = min(bottom,(rows[row][1]+rows[row+1][0])/2 if row+1<len(rows) else bottom)
                        if right>left and lower>upper:
                            bands.append([round(left/page.rect.width,6),round(upper/page.rect.height,6),round(right/page.rect.width,6),round(lower/page.rect.height,6)])
                    if not bands:
                        raise ValueError(f"Lesson {lesson['number']}, item {label['number']}: empty English mask")
                    entry['visibleBands'] = bands
                excerpts.append(entry)
        if sorted(set(e['number'] for e in excerpts)) != list(range(1, lesson['numberedLineCount']+1)):
            raise ValueError(f"Lesson {lesson['number']}: incomplete English excerpts")
        lesson['englishSentenceExcerpts'] = excerpts
        total += len(excerpts)
    result = json.dumps(index, indent=2, ensure_ascii=False) + '\n'
    (ROOT / 'course/assimil-german.index.json').write_text(result)
    (ROOT / 'dist/course-index.json').write_text(result)
    print(f'Prepared {total} English prompt regions for 100 lessons. No text or images published.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdfs', type=Path, nargs=3)
    prepare(parser.parse_args().pdfs)
