import type { FieldSpec } from "@repo/contracts";
import { cn } from "@/lib/utils";

/** Everyday names for the job catalog's columns; custom columns use their own name. */
const COLUMN_NAME: Record<string, string> = {
  url: "link",
  match_reason: "why it matches",
  remote: "remote or on-site",
  employment_type: "job type",
  posted_at: "date posted",
};

export const columnName = (f: Pick<FieldSpec, "name" | "catalogKey">) => COLUMN_NAME[f.catalogKey] ?? f.name.replace(/_/g, " ");

/** The same name in sentence case, for table headings. */
export const columnTitle = (f: Pick<FieldSpec, "name" | "catalogKey">) => {
  const name = columnName(f);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * The columns of the list. A solid black chip is a must-have (rows without it are set aside); a
 * dashed one is nice to have. Pressing a chip switches it when the plan can still change.
 */
export function ColumnChips({ fields, onToggle }: { fields: FieldSpec[]; onToggle?: (name: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-tight" aria-label="Columns">
      {fields.map((f) => {
        const chip = cn(
          "inline-flex items-center rounded-full border px-3 py-1 font-mono text-small",
          f.required ? "border-ink bg-ink text-sheet" : "border-dashed border-graphite text-graphite",
        );
        const label = (
          <>
            {columnName(f)}
            <span className="sr-only">{f.required ? " (must have)" : " (nice to have)"}</span>
          </>
        );
        return (
          <li key={f.name}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={f.required}
                title={f.required ? "Must have. Press to make it nice to have" : "Nice to have. Press to make it a must"}
                onClick={() => onToggle(f.name)}
                className={cn(chip, "transition-colors duration-(--duration-fast)", f.required ? "hover:bg-ink/85" : "hover:border-ink hover:text-ink")}
              >
                {label}
              </button>
            ) : (
              <span className={chip}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
