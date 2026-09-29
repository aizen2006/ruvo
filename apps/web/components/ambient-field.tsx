"use client";

import { usePathname } from "next/navigation";
import { DotField } from "@/components/dot-field";

/** The faint dot field behind every screen, kept to the side margins so text sits on clear paper. The landing page draws its own. */
export function AmbientField() {
  if (usePathname() === "/") return null;
  return <DotField tone="ink" intensity={0.25} interactive className="pointer-events-none fixed inset-0 -z-10 [mask-image:linear-gradient(90deg,black,transparent_calc(50%-600px),transparent_calc(50%+600px),black)]" />;
}
