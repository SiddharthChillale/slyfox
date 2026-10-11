// Checks that every quote the model returns appears in the segment it cites.
// A citation that fails is dropped; a flag left with no citations is dropped.

const MIN_QUOTE_CHARS = 8;

export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’\u201A\u2032`]/g, "'")
    .replace(/[“”\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteInSegment(quote: string, segmentText: string): boolean {
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

export interface Verified<F> {
  flags: F[];
  droppedCitations: number;
  droppedFlags: number;
}

export function verifyFlags<F extends { citations: Citation[] }>(flags: F[], segments: Segment[]): Verified<F> {
  const byId = new Map(segments.map((s) => [s.id, s.text]));
  let droppedCitations = 0;
  const kept: F[] = [];
  for (const flag of flags) {
    const citations = flag.citations.filter((c) => {
      const text = byId.get(c.segmentId);
      const ok = text !== undefined && quoteInSegment(c.quote, text);
      if (!ok) droppedCitations++;
      return ok;
    });
    if (citations.length) kept.push({ ...flag, citations });
  }
  return { flags: kept, droppedCitations, droppedFlags: flags.length - kept.length };
}
