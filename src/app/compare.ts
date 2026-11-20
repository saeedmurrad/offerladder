import { gbp, pct, signed } from './format';
import { Snapshot } from './models';

export type CriterionKey = 'value' | 'yield' | 'cash' | 'size' | 'condition' | 'leverage' | 'crime';

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

export interface Criterion {
  key: CriterionKey;
  /** Used in "Best for ..." */
  bestFor: string;
  label: string;
  better: 'higher' | 'lower';
  weight: number;
  value: (s: Snapshot) => number | null;
  /** The gap between best and worst that counts as fully decisive. Smaller gaps count for proportionally less. */
  decisive: (values: number[]) => number;
  format: (v: number) => string;
}

/** What the comparison scores, and how much each counts. Weights add up to 100. */
export const CRITERIA: Criterion[] = [
  {
    key: 'value',
    bestFor: 'Best price against nearby sales',
    label: 'Asking price vs middle value',
    better: 'lower',
    weight: 30,
    value: (s) => (s.inputs.asking ? (s.inputs.asking / s.mid - 1) * 100 : null),
    decisive: () => 10,
    format: (v) => signed(v, 0),
  },
  { key: 'yield', bestFor: 'Best rental return', label: 'Net yield at target price', better: 'higher', weight: 25, value: (s) => s.netYieldAtTarget, decisive: () => 1.5, format: (v) => pct(v) },
  { key: 'cash', bestFor: 'Least cash needed', label: 'Cash needed at target price', better: 'lower', weight: 10, value: (s) => s.cashAtTarget, decisive: (v) => mean(v) * 0.15, format: (v) => gbp(v) },
  {
    key: 'size',
    bestFor: 'Most space for the money',
    label: 'Target price per m²',
    better: 'lower',
    weight: 10,
    value: (s) => (s.inputs.floorArea ? s.target / s.inputs.floorArea : null),
    decisive: (v) => mean(v) * 0.15,
    format: (v) => gbp(v),
  },
  { key: 'condition', bestFor: 'Best condition and energy rating', label: 'Condition adjustment', better: 'higher', weight: 10, value: (s) => s.adjustPct, decisive: () => 8, format: (v) => signed(v, 0) },
  { key: 'leverage', bestFor: 'Most room to negotiate', label: 'Days on the market', better: 'higher', weight: 5, value: (s) => s.daysListed, decisive: () => 60, format: (v) => `${Math.round(v)} days` },
  { key: 'crime', bestFor: 'Lowest recorded crime nearby', label: 'Crimes within a mile (latest month)', better: 'lower', weight: 10, value: (s) => s.crimeTotal, decisive: (v) => mean(v) * 0.3, format: (v) => `${Math.round(v)}` },
];

/** A gap under 15% of the decisive gap is treated as a tie when naming a "best". */
const MATERIAL = 0.15;

export interface CriterionResult {
  criterion: Criterion;
  values: (number | null)[];
  /** 0 to 1 for each house (1 = best of the group), or null when the criterion could not be scored. */
  scores: (number | null)[];
  /** 0 to 1: how much the gap between best and worst matters. */
  strength: number;
  /** Index of the single clearly best house, or null on a tie, a negligible gap or missing data. */
  best: number | null;
  /** Every house has the figure. */
  complete: boolean;
  scored: boolean;
}

export interface Comparison {
  results: CriterionResult[];
  /** 0 to 100 for each house. 50 means level with the others. */
  totals: number[];
  pick: number;
  runnerUp: number | null;
  /** Points between the pick and the next best. Under 5 is a close call. */
  margin: number;
  reasons: string[];
  cautions: string[];
  roughValuation: boolean;
  weightUsed: number;
}

/**
 * Scores two or three houses against each other.
 * Per criterion the best house gets 1 and the worst 0, then the criterion's weight is scaled by how
 * large the gap really is, so a 0.2-point difference in yield does not swing the result like a 2-point one.
 * A criterion is left out when any house lacks the figure. Houses that are level all score 50.
 */
export function compare(list: Snapshot[]): Comparison | null {
  if (list.length < 2) return null;
  const results: CriterionResult[] = CRITERIA.map((criterion) => {
    const values = list.map((s) => {
      const v = criterion.value(s);
      return v !== null && Number.isFinite(v) ? v : null;
    });
    const complete = values.every((v) => v !== null);
    const none = { criterion, values, scores: values.map(() => null), strength: 0, best: null, complete, scored: false };
    if (!complete) return none;
    const nums = values as number[];
    const hi = Math.max(...nums);
    const lo = Math.min(...nums);
    if (hi === lo) return none;
    const decisive = criterion.decisive(nums);
    const strength = decisive > 0 ? Math.min(1, (hi - lo) / decisive) : 1;
    const bestValue = criterion.better === 'higher' ? hi : lo;
    const scores = nums.map((v) => (criterion.better === 'higher' ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
    const winners = nums.filter((v) => v === bestValue).length;
    return { criterion, values, scores, strength, best: winners === 1 && strength >= MATERIAL ? nums.indexOf(bestValue) : null, complete, scored: true };
  });

  const weightUsed = results.filter((r) => r.complete).reduce((sum, r) => sum + r.criterion.weight, 0);
  const scoredResults = results.filter((r) => r.scored);
  const totals = list.map((_, i) =>
    weightUsed ? 50 + (scoredResults.reduce((sum, r) => sum + r.criterion.weight * r.strength * ((r.scores[i] as number) - 0.5), 0) / weightUsed) * 100 : 50,
  );
  const order = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]);
  const pick = order[0][1];
  const runnerUp = order.length > 1 ? order[1][1] : null;
  const margin = runnerUp !== null ? totals[pick] - totals[runnerUp] : 0;

  const byImpact = [...scoredResults].sort((a, b) => b.criterion.weight * b.strength - a.criterion.weight * a.strength);
  const reasons = byImpact
    .filter((r) => r.best === pick)
    .slice(0, 4)
    .map((r) => `${r.criterion.bestFor}: ${r.criterion.format(r.values[pick] as number)}.`);
  const cautions = byImpact
    .filter((r) => r.scores[pick] === 0 && r.strength >= MATERIAL)
    .map((r) => `Weakest of the group on ${r.criterion.label.toLowerCase()}: ${r.criterion.format(r.values[pick] as number)}.`);

  return { results, totals, pick, runnerUp, margin, reasons, cautions, roughValuation: list.some((s) => s.basis !== 'perM2'), weightUsed };
}
