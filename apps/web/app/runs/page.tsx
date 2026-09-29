import { redirect } from "next/navigation";

/** The run history moved to "Your datasets". */
export default function RunsPage() {
  redirect("/datasets");
}
