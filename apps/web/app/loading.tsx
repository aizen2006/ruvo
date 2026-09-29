import { FallingCat } from "@/components/falling-cat";

/** While a page loads: the falling cat on a black panel. */
export default function Loading() {
  return <FallingCat className="h-[min(60vh,560px)] min-h-80 rounded-panel" />;
}
