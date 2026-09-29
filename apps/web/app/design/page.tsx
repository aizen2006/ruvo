import { notFound } from "next/navigation";
import { DesignSheet } from "@/components/design/design-sheet";

export const metadata = { title: "Design system · RUVO" };

/** Every token and component in one place, for design review. Development only. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSheet />;
}
