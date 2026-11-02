// Finds numbers in an agent reply that no tool result or user message backs
// up, so the eval can catch numbers the model computed or made up.

const NUMBER = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(million|thousand|[MK])(?![A-Za-z]))?/gi;
const LIST_MARKER = /^\s*\d+[.)]\s+/gm;
const UNITS: Record<string, number> = { million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

type Token = { text: string; value: number; decimals: number; unit: number };

function tokens(text: string): Token[] {
  return [...text.replace(LIST_MARKER, "").matchAll(NUMBER)].map((m) => ({
    text: m[0],
    value: Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "0"}`),
    decimals: m[2]?.length ?? 0,
    unit: m[3] ? UNITS[m[3].toLowerCase()] : 1,
  }));
}

/** Every number in the sources: JSON numbers, and numbers written inside strings. */
function sourceNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(Math.abs(value));
  else if (typeof value === "string") for (const t of tokens(value)) out.push(t.value * t.unit);
  else if (Array.isArray(value)) for (const item of value) sourceNumbers(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) sourceNumbers(item, out);
  return out;
}

/** A reply number is backed when some source, in the reply's unit and rounded to its decimals, equals it. */
const backs = (source: number, token: Token) => {
  const scale = 10 ** token.decimals;
  return Math.abs(Math.round((source / token.unit) * scale) / scale - token.value) < 1e-9;
};

/** The reply's numbers (as written) that no source backs; empty means every number is grounded. */
export function ungrounded(reply: string, sources: unknown[]): string[] {
  const known = sourceNumbers(sources);
  return tokens(reply).filter((t) => !known.some((s) => backs(s, t))).map((t) => t.text);
}
