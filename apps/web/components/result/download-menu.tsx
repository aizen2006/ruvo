"use client";

import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

/** The list as a file: an Excel workbook with receipts by default, a plain spreadsheet, data for developers, or every row. */
export function DownloadMenu({ runId }: { runId: string }) {
  const files = [
    { label: "Excel workbook (.xlsx)", href: api.exportUrl(runId, "xlsx", "valid") },
    { label: "Spreadsheet (CSV)", href: api.exportUrl(runId, "csv", "valid") },
    { label: "Data file (JSON)", href: api.exportUrl(runId, "json", "valid") },
    { label: "Every row, with those set aside (CSV)", href: api.exportUrl(runId, "csv", "all") },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary">
          <Download /> Download <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="font-mono">
        {files.map((f) => (
          <DropdownMenuItem key={f.label} asChild>
            <a href={f.href} download>
              {f.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
