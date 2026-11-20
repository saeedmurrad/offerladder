export function gbp(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return (n < 0 ? '-£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(digits)}%`;
}

export function signed(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
