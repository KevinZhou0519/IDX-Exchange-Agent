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
  thousand: 1_000,
  grand: 1_000,
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
  // The word right after the number scales it only when it is a multiplier;
  // units such as "sqft" or "miles" leave the number as written.
  const match = /(\d[\d,]*(?:\.\d+)?)\s*([a-z]*)/i.exec(s);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = MULTIPLIERS[match[2].toLowerCase()] ?? 1;
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

const AMOUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

type AmountToken = { base: number; multiplier: number | null; start: number; end: number };

/**
 * Every amount in the text, for checking a value against its quote:
 * "1 to 2 million" → 1M and 2M (a bare number shares the next number's
 * multiplier across "to", "-", "and", "or"), "under a million", "700 thousand",
 * "half a million". Word numbers only count when a multiplier follows them.
 */
export function parseAmounts(s: string): number[] {
  const text = s.toLowerCase().replace(/\bhalf an? (million|mil|m|billion)\b/g, "0.5 $1");
  const tokens: AmountToken[] = [];
  const pattern = /(\d[\d,]*(?:\.\d+)?|\b(?:an?|one|two|three|four|five|six|seven|eight|nine|ten)\b)\s*([a-z]*)/g;
  for (const match of text.matchAll(pattern)) {
    const [whole, number, suffix] = match;
    const multiplier = MULTIPLIERS[suffix] ?? null;
    const isDigits = /^\d/.test(number);
    if (!isDigits && multiplier === null) continue;
    const base = isDigits ? Number(number.replace(/,/g, "")) : AMOUNT_WORDS[number];
    const start = match.index;
    // A non-multiplier word after the number ("to", "and") is not part of the amount.
    const end = start + (multiplier === null ? number.length : whole.length);
    tokens.push({ base, multiplier, start, end });
  }
  const amounts = new Set<number>();
  tokens.forEach((token, i) => {
    amounts.add(Math.round(token.base * (token.multiplier ?? 1)));
    const next = tokens[i + 1];
    if (token.multiplier === null && next?.multiplier != null) {
      const between = text.slice(token.end, next.start);
      if (/^\s*(?:-|–|to|and|or)\s*\$?\s*$/.test(between)) {
        amounts.add(Math.round(token.base * next.multiplier));
      }
    }
  });
  return [...amounts];
}
