"use client";

import type { DatasetContract, RunDetail } from "@repo/contracts";
import { columnTitle } from "@/components/plan/column-chips";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cellText, tableColumns } from "@/lib/cells";
import { useRecords } from "@/lib/queries";

const PREVIEW = 8;
const PREVIEW_COLUMNS = 4;

/** The best-matching valid rows so far while collecting. Each new row fades in with a brief highlight. */
export function PreviewRows({ run }: { run: RunDetail }) {
  const { data } = useRecords(run.id, { status: "valid", pageSize: PREVIEW }, run.status);
  const columns = tableColumns(run.contract as DatasetContract).slice(0, PREVIEW_COLUMNS);
  if (!data || data.items.length === 0) {
    return <p className="text-small text-graphite">The first rows appear here as each source finishes.</p>;
  }

  return (
    <section aria-labelledby="preview" className="space-y-item">
      <h2 id="preview" className="text-body font-semibold">
        First rows
      </h2>
      <div className="overflow-hidden rounded-panel border border-hairline bg-sheet">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((f) => (
                <TableHead key={f.name}>{columnTitle(f)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((record) => (
              <TableRow key={record.id} className="animate-row-in">
                {columns.map((f) => (
                  <TableCell key={f.name} className="max-w-72 truncate">
                    {cellText(record.data[f.name])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
