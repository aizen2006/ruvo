import type { Evidence, ListRecordsQuery, Page, PageVia, RecordDTO } from "@repo/contracts";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { notFound } from "../../libs/errors";
import { db } from "../client";
import { evidence, pages, records } from "../schema";

type RecordRow = typeof records.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;

/** Data field names for catalog concepts, resolved from the run's contract. */
export interface FieldNames {
  remote: string | null;
  salary: string | null;
}

export function toRecordDTO(r: RecordRow): RecordDTO {
  return {
    id: r.id,
    runId: r.runId,
    sourceId: r.sourceId,
    data: r.data,
    status: r.status,
    duplicateOf: r.duplicateOf,
    matchScore: r.matchScore,
    confidence: r.confidence,
    signals: r.signals,
    rejectReasons: r.rejectReasons,
    seenOn: r.seenOn,
    createdAt: r.createdAt.toISOString(),
  };
}

/** `via` is how the evidence's page was fetched, when there is a page. */
export function toEvidenceDTO(e: EvidenceRow, via?: PageVia | null): Evidence {
  return {
    field: e.field,
    value: e.value,
    method: e.method,
    sourceUrl: e.sourceUrl,
    pageId: e.pageId,
    snippet: e.snippet,
    locator: e.locator,
    verified: e.verified,
    confidence: e.confidence,
    capturedAt: e.capturedAt.toISOString(),
    ...(via && { fetchedVia: via }),
  };
}

/** Escapes LIKE wildcards so user search text is matched literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function recordFilters(runId: string, q: Partial<ListRecordsQuery>, fields: FieldNames): SQL | undefined {
  const filters: Array<SQL | undefined> = [eq(records.runId, runId)];
  if (!q.includeDuplicates) filters.push(isNull(records.duplicateOf));
  if (q.status) filters.push(eq(records.status, q.status));
  if (q.source) filters.push(eq(records.sourceId, q.source));
  if (q.minConfidence !== undefined) filters.push(gte(records.confidence, q.minConfidence));
  if (q.q) filters.push(sql`${records.data}::text ilike ${likePattern(q.q)}`);
  if (q.remote && fields.remote) filters.push(sql`${records.data}->>${fields.remote} = ${q.remote}`);
  if (q.hasSalary !== undefined && fields.salary) {
    const salary = sql`${records.data}->>${fields.salary}`;
    filters.push(q.hasSalary ? isNotNull(salary) : isNull(salary));
  }
  return and(...filters);
}

/** Valid records first, then the best leads (see leadOf). */
const ordering = [
  sql`case ${records.status} when 'valid' then 0 when 'incomplete' then 1 else 2 end`,
  desc(sql`${records.matchScore} + ${records.confidence}`),
  asc(records.createdAt),
];

export async function listRecords(runId: string, query: ListRecordsQuery, fields: FieldNames): Promise<Page<RecordDTO>> {
  const where = recordFilters(runId, query, fields);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(records)
      .where(where)
      .orderBy(...ordering)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(records).where(where),
  ]);
  return { items: rows.map(toRecordDTO), total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function getRecordWithEvidence(runId: string, recordId: string) {
  const [record] = await db
    .select()
    .from(records)
    .where(and(eq(records.id, recordId), eq(records.runId, runId)));
  if (!record) throw notFound("Record");
  const rows = await db
    .select({ evidence, via: pages.via })
    .from(evidence)
    .leftJoin(pages, eq(pages.id, evidence.pageId))
    .where(eq(evidence.recordId, recordId))
    .orderBy(evidence.field);
  return { record: toRecordDTO(record), evidence: rows.map((r) => toEvidenceDTO(r.evidence, r.via)) };
}

export interface ExportRow {
  record: RecordDTO;
  evidence: Evidence[];
  /** "field:METHOD" pairs, sorted and joined, for flat files. */
  evidenceMethods: string;
}

/** All records for export, each with its evidence. */
export async function exportRecords(runId: string, scope: "valid" | "all"): Promise<ExportRow[]> {
  const where = and(eq(records.runId, runId), isNull(records.duplicateOf), scope === "valid" ? eq(records.status, "valid") : undefined);
  const rows = await db.select().from(records).where(where).orderBy(...ordering);
  const evidenceRows = await db
    .select({ evidence })
    .from(evidence)
    .innerJoin(records, eq(records.id, evidence.recordId))
    .where(where)
    .orderBy(evidence.field);

  const evidenceByRecord = new Map<string, Evidence[]>();
  for (const { evidence: e } of evidenceRows) {
    const list = evidenceByRecord.get(e.recordId) ?? [];
    list.push(toEvidenceDTO(e));
    evidenceByRecord.set(e.recordId, list);
  }
  return rows.map((r) => {
    const found = evidenceByRecord.get(r.id) ?? [];
    const evidenceMethods = found
      .map((e) => `${e.field}:${e.method}`)
      .sort()
      .join("; ");
    return { record: toRecordDTO(r), evidence: found, evidenceMethods };
  });
}
