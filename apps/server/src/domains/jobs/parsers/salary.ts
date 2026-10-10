export type SalaryPeriod = "year" | "month" | "hour";

export interface SalaryRange {
  min: number;
  max: number;
  currency: string | null;
  period: SalaryPeriod;
  /** The exact text the range was parsed from, used as evidence. */
  raw: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  US$: "USD",
  C$: "CAD",
  CA$: "CAD",
  A$: "AUD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
};
const CURRENCY_CODES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "CHF", "SGD", "JPY"];

const SYMBOL = String.raw`(?:US\$|CA\$|C\$|A\$|\$|€|£|₹)`;
const CODE = String.raw`(?:${CURRENCY_CODES.join("|")})`;
// Western grouping (120,000 / 120.000), Indian lakh grouping (30,00,000), or a plain number.
const AMOUNT = String.raw`\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?`;
const SUFFIX = String.raw`[kKmM]`;
const DASH = String.raw`\s*(?:-|–|—|to)\s*`;

/**
 * Matches e.g. "$120k-$160k", "€75k–110k", "USD 200,000 – 250,000", "120-150k GBP", "$85/hr".
 * Groups: preCode, preSymbol, amount1, suffix1, (midSymbol, amount2, suffix2), postCode.
 */
const SALARY_RE = new RegExp(
  String.raw`(?:(${CODE})\s?)?(${SYMBOL})?\s?(${AMOUNT})\s?(${SUFFIX})?` +
    String.raw`(?:${DASH}(${SYMBOL})?\s?(${AMOUNT})\s?(${SUFFIX})?)?` +
    String.raw`(?:\s?(${CODE}))?`,
  "g",
);

const PERIOD_PATTERNS: Array<[RegExp, SalaryPeriod]> = [
  [/^\s*(?:\/\s*(?:hr|hour)|per\s+hour|an\s+hour|hourly)/i, "hour"],
  [/^\s*(?:\/\s*(?:mo|month)|per\s+month|monthly)/i, "month"],
  [/^\s*(?:\/\s*(?:yr|year|annum)|per\s+(?:year|annum)|a\s+year|annually|annual|p\.?a\.?)/i, "year"],
];

/** Plausible salary bounds per period (in USD-like units), used to reject funding rounds and the like. */
const PLAUSIBLE: Record<SalaryPeriod, [number, number]> = {
  year: [10_000, 2_000_000],
  month: [1_000, 200_000],
  hour: [8, 1_000],
};
/** High-denomination currencies scale the plausible bounds. */
const CURRENCY_SCALE: Record<string, number> = { INR: 100, JPY: 150 };

/**
 * Finds the first plausible salary range in free text. A match needs a currency marker
 * (symbol or code) or a thousands suffix on a range, so bare numbers aren't mistaken for pay.
 */
export function parseSalary(text: string): SalaryRange | null {
  const clean = text.replace(/401\s?\(?k\)?/gi, " ");
  for (const m of clean.matchAll(SALARY_RE)) {
    const [raw, preCode, preSymbol, a1, s1, midSymbol, a2, s2, postCode] = m;
    const hasCurrency = Boolean(preCode || preSymbol || midSymbol || postCode);
    const hasRangeWithK = Boolean(a2 && (s1 || s2));
    if (!hasCurrency && !hasRangeWithK) continue;

    // "120-150k": a suffix on the upper bound applies to the lower bound too.
    const min = toNumber(a1!, s1 ?? (a2 ? s2 : undefined));
    const max = a2 ? toNumber(a2, s2 ?? s1) : min;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) continue;

    const symbol = preSymbol ?? midSymbol;
    const currency = preCode ?? postCode ?? (symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null);
    const after = clean.slice((m.index ?? 0) + raw.length, (m.index ?? 0) + raw.length + 20);
    const statedPeriod = periodFrom(after);
    // A lone small amount with no period ("a $100 stipend") is not a salary.
    if (!a2 && !statedPeriod && max < 1000) continue;
    const period = statedPeriod ?? (max < 1000 ? "hour" : "year");
    const scale = CURRENCY_SCALE[currency ?? ""] ?? 1;
    const [low, high] = PLAUSIBLE[period];
    if (min < low || max > high * scale) continue;

    return { min, max, currency, period, raw: raw.trim() };
  }
  return null;
}

/** Human-readable form, e.g. "USD 120,000–160,000 / year". */
export function formatSalary(s: Pick<SalaryRange, "min" | "max" | "currency" | "period">): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const amount = s.min === s.max ? fmt(s.min) : `${fmt(s.min)}–${fmt(s.max)}`;
  return `${s.currency ? `${s.currency} ` : ""}${amount} / ${s.period}`;
}

function toNumber(amount: string, suffix?: string): number {
  // "120,000", "120.000" and "30,00,000" use grouping separators; "85.5" is a decimal.
  const grouped = /^\d{1,3}(?:[,.]\d{3})+$/.test(amount) || /^\d{1,2}(?:,\d{2})+,\d{3}$/.test(amount);
  const value = grouped ? Number(amount.replace(/[,.]/g, "")) : Number(amount);
  if (suffix?.toLowerCase() === "k") return value * 1_000;
  if (suffix?.toLowerCase() === "m") return value * 1_000_000;
  return value;
}

function periodFrom(textAfter: string): SalaryPeriod | null {
  return PERIOD_PATTERNS.find(([re]) => re.test(textAfter))?.[1] ?? null;
}
