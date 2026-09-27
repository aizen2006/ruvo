import type { Evidence, ListRecordsQuery, Page, RecordDTO } from "@repo/contracts";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { notFound } from "../../libs/errors";
import { db } from "../client";
import { evidence, records } from "../schema";

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

export function toEvidenceDTO(e: EvidenceRow): Evidence {
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

/** Valid records first, then best matches. */
const ordering = [
  sql`case ${records.status} when 'valid' then 0 when 'incomplete' then 1 else 2 end`,
  desc(records.matchScore),
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
  const rows = await db.select().from(evidence).where(eq(evidence.recordId, recordId)).orderBy(evidence.field);
  return { record: toRecordDTO(record), evidence: rows.map(toEvidenceDTO) };
}

/** All records for export, with the extraction method of each field. */
export async function exportRecords(runId: string, scope: "valid" | "all") {
  const where = and(eq(records.runId, runId), isNull(records.duplicateOf), scope === "valid" ? eq(records.status, "valid") : undefined);
  const rows = await db.select().from(records).where(where).orderBy(...ordering);
  const methods = await db
    .select({ recordId: evidence.recordId, field: evidence.field, method: evidence.method })
    .from(evidence)
    .innerJoin(records, eq(records.id, evidence.recordId))
    .where(where);

  const methodsByRecord = new Map<string, string[]>();
  for (const m of methods) {
    const list = methodsByRecord.get(m.recordId) ?? [];
    list.push(`${m.field}:${m.method}`);
    methodsByRecord.set(m.recordId, list);
  }
  return rows.map((r) => ({ record: toRecordDTO(r), evidenceMethods: (methodsByRecord.get(r.id) ?? []).sort().join("; ") }));
}
