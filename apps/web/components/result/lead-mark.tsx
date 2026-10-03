import type { RecordDTO } from "@repo/contracts";
import { Tooltip } from "@/components/ui/tooltip";
import { LEAD_SCORE_HINT, LEAD_TIER_LABEL, leadOf } from "@/lib/plain";

/** A row's lead tier and score, read as "Strong 93"; rows that aren't leads show a dash. */
export function LeadMark({ record }: { record: RecordDTO }) {
  const lead = leadOf(record);
  if (!lead) return <span className="text-pencil">—</span>;
  return (
    <Tooltip content={`${lead.score} of 100. ${LEAD_SCORE_HINT}.`}>
      <span tabIndex={0} className="inline-flex items-baseline gap-1.5 rounded-control font-mono text-micro whitespace-nowrap">
        {LEAD_TIER_LABEL[lead.tier]}
        <span className="text-graphite tabular">{lead.score}</span>
      </span>
    </Tooltip>
  );
}
