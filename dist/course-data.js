// Small, prepared metadata only. The book, recordings and speech models stay private.
export function preparedLesson(index, number) {
  return index?.lessons.find(lesson => lesson.number === number) || null;
}

export function fingerprintCandidates(index, kind, bytes) {
  if (!index) return [];
  return kind === 'pdf'
    ? index.book.sources.filter(source => source.bytes === bytes)
    : index.lessons.map(lesson => lesson.audio).filter(audio => audio?.bytes === bytes);
}

export function matchedSource(index, file) {
  return file?.kind === 'pdf' && file.sha256
    ? index?.book.sources.find(source => source.sha256 === file.sha256) || null : null;
}

export function matchedCombinedBook(index, file) {
  return file?.kind==='pdf' && !!index?.book.combinedLayoutSignature &&
    file.verifiedBookLayout===index.book.combinedLayoutSignature;
}

export function matchedAudio(index, file) {
  return file?.kind === 'audio' && file.sha256
    ? index?.lessons.find(lesson => lesson.audio?.sha256 === file.sha256) || null : null;
}

export function pageCrop(bounds) {
  const [left, top, right, bottom] = bounds;
  return {x:left, y:top, w:right-left, h:bottom-top};
}

export function lessonPages(index, library, number, recall = false) {
  const lesson = preparedLesson(index, number);
  if (!lesson) return null;
  const sources = new Map(library.filter(file => file.kind === 'pdf')
    .flatMap(file => {const source=matchedSource(index,file);return source ? [[source.id,file]] : [];}));
  const refs = recall ? lesson.englishRecall : lesson.studyPages;
  const combined=library.find(file=>matchedCombinedBook(index,file));
  return refs.map(ref => ({file:combined||sources.get(ref.sourceId)||null, sourceId:ref.sourceId,
    page:combined?ref.globalPage:ref.sourcePage, globalPage:ref.globalPage, crop:pageCrop(ref.crop),
    label:`Book page ${ref.globalPage-index.book.printedPageOffset}`}));
}

export function preparedSentences(lesson) {
  const spans = lesson?.audio?.sentenceAlignment?.sentenceSegments || [];
  // Playback padding must not spill into a neighbouring sentence.
  return spans.map((span,i) => ({
    start:Math.max(span.playStart ?? span.start, i ? (spans[i-1].end+span.start)/2 : 0),
    end:Math.min(span.playEnd ?? span.end, i+1<spans.length ? (span.end+spans[i+1].start)/2 : Infinity),
    needsReview:!!span.needsReview
  }));
}

export function preparedDialogue(lesson, includeRepeat = false) {
  const audio=lesson?.audio;
  if(!audio?.dialogue)return null;
  const range={...audio.dialogue};
  if(includeRepeat&&audio.repeatDialogue)
    range.end=Math.min(audio.duration,Math.max(range.end,audio.repeatDialogue.end+.1));
  return range;
}
