export function distribution(values) {
  const v = [...values].sort((a, b) => a - b);
  return v.length
    ? {
        n: v.length,
        min: v[0],
        p50: v[Math.ceil(v.length * 0.5) - 1],
        p95: v[Math.ceil(v.length * 0.95) - 1],
        max: v.at(-1),
      }
    : { n: 0 };
}
