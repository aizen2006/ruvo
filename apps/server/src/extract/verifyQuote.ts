/**
 * Finds a quote inside source text, tolerating the differences an LLM (or a copy-paste)
 * introduces: whitespace runs, curly vs straight quotes, dash variants, and letter case.
 * Returns the span in the ORIGINAL text, so evidence points at exactly what the source says.
 */
export function verifyQuote(quote: string, text: string): { start: number; end: number } | null {
  const needle = normalize(quote);
  if (needle.value.length < 2) return null;
  const haystack = normalize(text);

  const at = haystack.value.indexOf(needle.value);
  if (at < 0) return null;
  const start = haystack.origin[at]!;
  const end = haystack.origin[at + needle.value.length - 1]! + 1;
  return { start, end };
}

const EQUIVALENT: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "−": "-",
  " ": " ",
};

/** Normalized text plus, for each normalized character, its index in the original. */
function normalize(text: string): { value: string; origin: number[] } {
  let value = "";
  const origin: number[] = [];
  let lastWasSpace = true; // also trims leading whitespace
  for (let i = 0; i < text.length; i++) {
    const ch = EQUIVALENT[text[i]!] ?? text[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        value += " ";
        origin.push(i);
      }
      lastWasSpace = true;
      continue;
    }
    value += ch.toLowerCase();
    origin.push(i);
    lastWasSpace = false;
  }
  if (value.endsWith(" ")) {
    value = value.slice(0, -1);
    origin.pop();
  }
  return { value, origin };
}
