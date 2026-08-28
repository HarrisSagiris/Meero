/** Compact token counts for display, e.g. 18432 -> "18.4k", 2000000 -> "2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const m = n / 1_000_000;
  return `${m.toFixed(m >= 10 ? 0 : 1).replace(/\.0$/, "")}M`;
}
