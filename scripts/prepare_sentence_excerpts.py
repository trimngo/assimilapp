#!/usr/bin/env python3
"""Prepare sentence crop coordinates; book text and images stay in the user's PDF."""
import argparse
import json
from pathlib import Path
import fitz
import numpy as np
from dialogue_units import extract_units
from preprocess_book import lines, sha256

ROOT = Path(__file__).resolve().parents[1]

def separate_rows(page, items, top, bottom):
    """OCR boxes overlap on this scan. Cut at the actual whitespace between items."""
    if len(items)<2:
        return
    left=min(item['box'][0] for item in items)
    right=max(item['box'][2] for item in items)
    pix=page.get_pixmap(matrix=fitz.Matrix(2,2),clip=fitz.Rect(left,top,right,bottom),colorspace=fitz.csGRAY,alpha=False)
    gray=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width)
    ink=(gray<140).sum(axis=1)
    for before,after in zip(items,items[1:]):
        last=max((row[1]+row[3])/2 for row in before['rows'])
        first=min((row[1]+row[3])/2 for row in after['rows'])
        target=(last+first)/2
        lo=max(0,round((target-6)*2)-pix.y)
        hi=min(len(ink),round((target+6)*2)-pix.y)
        quiet=np.flatnonzero(ink[lo:hi]<=max(2,pix.width*.002))+lo
        runs=np.split(quiet,np.where(np.diff(quiet)>1)[0]+1) if len(quiet) else []
        runs=[run for run in runs if len(run)>=2]
        if runs:
            row=min(((run[0]+run[-1])/2 for run in runs),key=lambda y:abs((y+pix.y)/2-target))
        else:
            row=min(range(lo,hi),key=lambda y:(ink[y],abs((y+pix.y)/2-target)))
        boundary=(row+pix.y)/2
        before['box'][3]=min(before['box'][3],boundary)
        after['box'][1]=max(after['box'][1],boundary)

def prepare(paths):
    index = json.loads((ROOT / 'course/assimil-german.index.json').read_text())
    if len(paths) != 3:
        raise ValueError('Supply the three original PDF parts in page order.')
    docs = []
    for path, source in zip(paths, index['book']['sources']):
        if sha256(path) != source['sha256']:
            raise ValueError(f'{path.name}: use the exact prepared PDF.')
        docs.append(fitz.open(path))
    sources = dict(zip((s['id'] for s in index['book']['sources']), docs))
    corrections = json.loads((ROOT / 'course/dialogue-label-corrections.json').read_text())['pages']
    count = 0
    for lesson in index['lessons']:
        excerpts = []
        for ref in lesson['germanDialogue']:
            page = sources[ref['sourceId']][ref['sourcePage'] - 1]
            top, bottom = ref['crop'][1] * page.rect.height, ref['crop'][3] * page.rect.height
            items = extract_units(page.get_text('words'), lines(page), ref['numberedLines'], top, bottom,
                                  lesson['number'], corrections.get(str(ref['globalPage'])), with_boxes=True)
            separate_rows(page,items,top,bottom)
            for item in items:
                if 'box' not in item:
                    raise ValueError(f"Lesson {lesson['number']}, item {item['line']}: missing text region")
                x0, y0, x1, y1 = item['box']
                excerpts.append({'number': item['line'], 'globalPage': ref['globalPage'],
                                 'sourceId': ref['sourceId'], 'sourcePage': ref['sourcePage'],
                                 'crop': [round(max(0, x0) / page.rect.width, 6), round(y0 / page.rect.height, 6),
                                          round(min(page.rect.width, x1) / page.rect.width, 6), round(y1 / page.rect.height, 6)]})
        if [e['number'] for e in excerpts] != list(range(1, lesson['numberedLineCount'] + 1)):
            raise ValueError(f"Lesson {lesson['number']}: incomplete sentence excerpts")
        lesson['sentenceExcerpts'] = excerpts
        count += len(excerpts)
    result = json.dumps(index, indent=2, ensure_ascii=False) + '\n'
    (ROOT / 'course/assimil-german.index.json').write_text(result)
    (ROOT / 'dist/course-index.json').write_text(result)
    print(f'Prepared {count} sentence excerpts for 100 lessons. No text or images published.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdfs', nargs=3, type=Path)
    prepare(parser.parse_args().pdfs)
