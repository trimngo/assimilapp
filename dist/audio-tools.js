// Pause detection is local and proposes editable phrase boundaries, not a transcript.
export function detectSegments(channels, sampleRate, duration) {
  const frame = Math.max(1, Math.floor(sampleRate * 0.02));
  const length = channels[0]?.length || 0;
  if (!length) return [];
  const rms = [];
  for (let pos = 0; pos < length; pos += frame) {
    let sum = 0, count = 0;
    for (const channel of channels) for (let j = pos; j < Math.min(pos + frame, length); j++) { sum += channel[j] ** 2; count++; }
    rms.push(Math.sqrt(sum / count));
  }
  const sorted = [...rms].sort((a,b) => a-b);
  const peak = sorted[Math.floor(sorted.length * .95)] || 0;
  if (peak < 0.0001) return [{start:0, end:duration}];
  const threshold = Math.max(0.001, peak * 0.055);
  const seconds = frame / sampleRate, spans = [];
  let start = null, lastVoice = 0;
  for (let i = 0; i < rms.length; i++) {
    const time = i * seconds;
    if (rms[i] > threshold) {
      if (start === null) start = Math.max(0, time - .08);
      lastVoice = Math.min(duration, time + seconds);
    } else if (start !== null && time - lastVoice >= .38) {
      const end = Math.min(duration, lastVoice + .08);
      if (end - start >= .3) spans.push({start:+start.toFixed(2), end:+end.toFixed(2)});
      start = null;
    }
  }
  if (start !== null && duration - start >= .3) spans.push({start:+start.toFixed(2), end:+Math.min(duration,lastVoice+.08).toFixed(2)});
  return spans.length ? spans : [{start:0,end:duration}];
}
export function validateSegments(segments, duration = Infinity) {
  if (!Array.isArray(segments) || segments.length > 1000) throw new Error('Choose a valid sentence list.');
  let previousEnd = 0;
  return segments.map((segment,i) => {
    const start=Number(segment.start), end=Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start || start<previousEnd-.005 || end>duration+.1) throw new Error(`Check sentence ${i+1}: times must be ordered, non-overlapping, and within the recording.`);
    previousEnd=end;return {start:+start.toFixed(2),end:+end.toFixed(2),...(segment.needsReview?{needsReview:true}:{})};
  });
}
export function replaceSegment(segments,index,times,duration=Infinity) {
  if(!Number.isInteger(index)||index<0||index>=segments.length)throw new Error('Choose a sentence to adjust.');
  const next=segments.map(segment=>({...segment}));
  next[index]={...next[index],start:+Number(times.start).toFixed(2),end:+Number(times.end).toFixed(2),needsReview:false};
  validateSegments(next,duration);
  return next;
}
export function parseSegments(text, duration) {
  return validateSegments(text.trim().split(/\n+/).filter(Boolean).map(line=>{
    const parts=line.trim().split(/\s*[,;]\s*|\s+/);
    if(parts.length!==2)throw new Error('Use one start, end pair per line, in seconds.');
    return {start:parts[0],end:parts[1]};
  }),duration);
}
export function formatTime(seconds) { if(!Number.isFinite(seconds))return '0:00';const m=Math.floor(seconds/60),s=Math.floor(seconds%60);return `${m}:${String(s).padStart(2,'0')}`; }
