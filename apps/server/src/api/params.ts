import type { DatasetContract } from "@repo/contracts";
import { z } from "zod";
import type { FieldNames } from "../db/repos/records";
import { notFound } from "../libs/errors";

const Uuid = z.string().uuid();

/** Parses a path id; malformed ids can never match a row, so they are reported as 404. */
export function parseId(raw: string | undefined, what: string): string {
  const parsed = Uuid.safeParse(raw);
  if (!parsed.success) throw notFound(what);
  return parsed.data;
}

/** Data field names for catalog concepts in a run's contract (null when the contract lacks them). */
export function fieldNamesOf(contract: DatasetContract | null): FieldNames {
  const nameOf = (key: string) => contract?.fields.find((f) => f.catalogKey === key)?.name ?? null;
  return { remote: nameOf("remote"), salary: nameOf("salary") };
}
