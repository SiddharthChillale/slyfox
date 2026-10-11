// Checks that every quote the model returns appears in the segment it cites.
// A citation that fails is dropped; a flag left with no citations is dropped.

const MIN_QUOTE_CHARS = 8;

export function normalize(text) {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteInSegment(quote, segmentText) {
  const haystack = normalize(segmentText);
  const cleaned = normalize(quote).replace(/^["']+|["']+$/g, '');
  // NFKC turns "…" into "...". The model may elide with one; each piece must appear in order.
  const parts = cleaned
    .split(/\s*\.\.\.\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.join('').length < MIN_QUOTE_CHARS) return false;
  let from = 0;
  for (const part of parts) {
    const at = haystack.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

export function verifyFlags(flags, segments) {
  const byId = new Map(segments.map((s) => [s.id, s.text]));
  let droppedCitations = 0;
  const kept = [];
  for (const flag of flags) {
    const citations = (Array.isArray(flag.citations) ? flag.citations : []).filter((c) => {
      const text = byId.get(c?.segmentId);
      const ok = text !== undefined && typeof c.quote === 'string' && quoteInSegment(c.quote, text);
      if (!ok) droppedCitations++;
      return ok;
    });
    if (citations.length) kept.push({ ...flag, citations });
  }
  return { flags: kept, droppedCitations, droppedFlags: flags.length - kept.length };
}
