import type { RecordDTO } from "@repo/contracts";

export const STATUS_TEXT: Record<RecordDTO["status"], string> = { valid: "Valid", incomplete: "Incomplete", invalid: "Rejected" };
export const STATUS_STYLE: Record<RecordDTO["status"], string> = {
  valid: "text-accent",
  incomplete: "text-pattern",
  invalid: "text-danger",
};
