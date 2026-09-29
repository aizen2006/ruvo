"use client";

import { useEffect, useState } from "react";

const KEY = "ruvo.showDetails";

/**
 * Whether the technical views are shown. A per-browser preference: storage can be missing or
 * blocked (private windows), so every access is guarded and the default is "hidden".
 */
export function useShowDetails(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      // Storage unavailable: keep the default.
    }
  }, []);

  const update = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Not remembered, but still applied for this visit.
    }
  };

  return [on, update];
}
