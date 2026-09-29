import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="max-w-2xl space-y-group border-t-8 border-ink pt-group">
      <h1 className="font-display text-display font-black">Page not found</h1>
      <p className="text-heading text-graphite">There&apos;s nothing at this address. It may have moved, or the link is incomplete.</p>
      <div className="flex flex-wrap gap-tight">
        <Button variant="primary" asChild>
          <Link href="/">Make a list</Link>
        </Button>
        <Button asChild>
          <Link href="/datasets">Your datasets</Link>
        </Button>
      </div>
    </div>
  );
}
