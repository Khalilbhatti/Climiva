/** nextId("INV", ["INV-1042", "INV-1040"]) → "INV-1043". Numbers the in-memory financial records (PAY, INV). */
export function nextId(prefix: string, ids: readonly string[]): string {
  const highest = ids.reduce((max, id) => {
    const number = Number(id.replace(`${prefix}-`, ""));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `${prefix}-${highest + 1}`;
}
