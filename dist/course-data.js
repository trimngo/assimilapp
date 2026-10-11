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
  return refs.map(ref => ({file:sources.get(ref.sourceId) || null, sourceId:ref.sourceId,
    page:ref.sourcePage, globalPage:ref.globalPage, crop:pageCrop(ref.crop),
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
