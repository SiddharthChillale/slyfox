// Local PII scrubbing. Runs in the extension before any text is sent to an API,
// so no model ever sees the values it replaces.

const digitsOf = (s: string) => s.replace(/\D/g, '');
const repeated = (s: string) => /^(\d)\1+$/.test(s);

export function luhn(num: string): boolean {
  if (repeated(num)) return false;
  let sum = 0;
  let double = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Aadhaar numbers end in a Verhoeff check digit. Callers pass digits only,
// so every table lookup is in range.
export function verhoeff(num: string): boolean {
  if (repeated(num)) return false;
  let c = 0;
  const reversed = [...num].reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(reversed[i])]!]!;
  }
  return c === 0;
}

interface Pattern {
  type: string;
  re: RegExp;
  valid?: (match: string) => boolean;
}

// Order matters: longer digit runs are claimed before shorter patterns can split them.
const PATTERNS: Pattern[] = [
  { type: 'EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi },
  { type: 'CARD', re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, valid: (m) => luhn(digitsOf(m)) },
  { type: 'AADHAAR', re: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g, valid: (m) => verhoeff(digitsOf(m)) },
  { type: 'PAN', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g },
  { type: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  {
    type: 'PHONE',
    re: /(?<![\w+])(?:(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}|(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4})(?!\d)/g,
  },
  { type: 'IP', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

export interface Scrubber {
  scrub(text: string): string;
  readonly counts: Record<string, number>;
  readonly total: number;
}

// One scrubber per analysis, so the same value gets the same placeholder in every segment.
export function createScrubber(): Scrubber {
  const seen = new Map<string, string>();
  const counts: Record<string, number> = {};

  function placeholder(type: string, value: string): string {
    const key = `${type}:${value}`;
    let found = seen.get(key);
    if (found === undefined) {
      counts[type] = (counts[type] ?? 0) + 1;
      found = `[${type}_${counts[type]}]`;
      seen.set(key, found);
    }
    return found;
  }

  return {
    scrub(text) {
      let out = text;
      for (const { type, re, valid } of PATTERNS) {
        out = out.replace(re, (m) => (valid && !valid(m) ? m : placeholder(type, m)));
      }
      return out;
    },
    counts,
    get total() {
      return Object.values(counts).reduce((a, b) => a + b, 0);
    },
  };
}
