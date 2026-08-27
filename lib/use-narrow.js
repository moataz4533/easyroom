"use client";
import { useEffect, useState } from "react";

/**
 * Whether the screen is too narrow for a table.
 *
 * A price grid is room type × head count × rate plan. On a laptop that is a
 * table and reads at a glance. On a phone with ten plans it became six
 * columns of four-line headings and inputs too narrow to show «١٢٠٠» —
 * which is what reception was actually looking at.
 *
 * CSS can restyle a table but cannot turn it into a different shape, so the
 * decision is made here and the component renders one thing or the other.
 * It starts wide so the server and the first client render agree, then
 * corrects itself immediately.
 */
export function useNarrow(maxWidth = 720) {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [maxWidth]);

  return narrow;
}
