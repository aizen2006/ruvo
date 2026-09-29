import Link from "next/link";
import { DatasetList } from "@/components/datasets/dataset-list";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Your datasets · RUVO" };

export default function DatasetsPage() {
  return (
    <div className="space-y-stack">
      <div className="flex items-end justify-between gap-item">
        <div className="space-y-item">
          <h1 className="font-display text-display font-black">Your datasets</h1>
          <p className="text-heading text-graphite">Every list you have made. Run one again to get fresh rows and see what changed.</p>
        </div>
        <Button variant="primary" asChild className="hidden sm:inline-flex">
          <Link href="/">New list</Link>
        </Button>
      </div>
      <DatasetList />
    </div>
  );
}
