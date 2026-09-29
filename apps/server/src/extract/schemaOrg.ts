import type { FieldSpec } from "@repo/contracts";

/** Reads schema.org records of any kind (JSON-LD) onto a contract's fields. */

type Node = Record<string, unknown>;

const RECORD_TYPE = /^(Person|Product|Event|CreativeWork|PodcastSeries|Book|Movie|SoftwareApplication)$|(Organization|Business|Corporation|Restaurant|Store)$/;

/** Properties that may answer a field, chosen by words in its name, else its description. */
const PROPERTY_HINTS: Array<[RegExp, string[]]> = [
  [/\b(name|title)\b/, ["name", "headline"]],
  [/\b(url|website|link)\b/, ["url"]],
  [/\b(address|location|city|country)\b/, ["address", "location"]],
  [/\b(bio|description|about|summary)\b/, ["description"]],
];

const typeOf = (node: Node) => ([] as unknown[]).concat(node["@type"] ?? []).map(String);
const isRecord = (node: Node) => typeOf(node).some((t) => RECORD_TYPE.test(t));

/** The records a page describes at its top level: a person, organization, product, event, work… */
export const schemaRecords = (items: Node[]) => items.filter(isRecord);

/** The entries of the page's ItemLists: their items, or the entries themselves when they carry a name. */
export function schemaListItems(items: Node[]): Node[] {
  return items
    .filter((n) => typeOf(n).includes("ItemList"))
    .flatMap((list) => ([] as unknown[]).concat(list.itemListElement ?? []))
    .map((entry) => ((entry as Node)?.item ?? entry) as Node)
    .filter((n) => Boolean(n) && typeof n === "object" && (isRecord(n) || typeof n.name === "string"));
}

/** A field's value from a record, with the property it came from. */
export function readSchemaField(record: Node, field: FieldSpec): { value: string; path: string } | null {
  // A property named like the field ("email", "jobTitle" for job_title) answers it directly.
  const wanted = field.name.replace(/_/g, "").toLowerCase();
  const hinted = (text: string) => PROPERTY_HINTS.filter(([re]) => re.test(text.replace(/_/g, " ").toLowerCase())).flatMap(([, p]) => p);
  const byName = hinted(`${field.name} ${field.catalogKey}`);
  const properties = [...Object.keys(record).filter((k) => k.toLowerCase() === wanted), ...(byName.length ? byName : hinted(field.description))];
  for (const path of properties) {
    const value = show(record[path]);
    if (value) return { value, path };
  }
  return null;
}

/** A property value as text: strings, numbers, named things, addresses, and lists of them. */
function show(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(show).filter(Boolean).join(", ") || null;
  if (!v || typeof v !== "object") return null;
  const node = v as Node;
  const address = [node.addressLocality, node.addressRegion, node.addressCountry].map(show).filter(Boolean).join(", ");
  return show(node.name) ?? (address || null) ?? show(node.address);
}
