// Turns free text into comparable strings and numbers. Everything that matches
// user words against the dataset or checks evidence goes through here.

const ABBREVIATIONS: Record<string, string> = {
  bch: "beach",
  st: "saint",
  mt: "mount",
  ft: "fort",
};

const WORD_NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mil: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
};

/** Lowercase, strip punctuation (keeping apostrophes) and expand common abbreviations. */
export function normalizeText(s: string): string {
  const cleaned = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((word) => ABBREVIATIONS[word] ?? word)
    .join(" ");
}

/** First dollar-style amount in the text: "$1.5M", "800k", "1.5 million", "$1,200,000". */
export function parseAmount(s: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million|b|billion)?(?![a-z])/i.exec(s);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1;
  return Math.round(base * multiplier);
}

/** First count in the text, as digits ("3br", "2.5 baths") or a word ("three"). */
export function parseCount(s: string): number | null {
  const digits = /\d+(?:\.\d+)?/.exec(s);
  if (digits) return Number(digits[0]);
  const words = normalizeText(s).split(" ");
  for (const word of words) {
    const index = WORD_NUMBERS.indexOf(word);
    if (index >= 0) return index;
  }
  return null;
}
