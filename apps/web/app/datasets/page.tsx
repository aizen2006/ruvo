import Link from "next/link";
import { DatasetList } from "@/components/datasets/dataset-list";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Your datasets · RUVO" };

export default function DatasetsPage() {
  return (
    <div className="space-y-group">
      <div className="flex items-end justify-between gap-item">
        <div className="space-y-1">
          <h1 className="text-title font-semibold">Your datasets</h1>
          <p className="text-graphite">Every list you have made. Run one again to get fresh rows and see what changed.</p>
        </div>
        <Button variant="primary" asChild className="hidden sm:inline-flex">
          <Link href="/">New list</Link>
        </Button>
      </div>
      <DatasetList />
    </div>
  );
}
