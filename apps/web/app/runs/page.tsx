import { RunHistory } from "@/components/run-history";

export default function HistoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl tracking-tight">Run history</h1>
      <RunHistory />
    </div>
  );
}
