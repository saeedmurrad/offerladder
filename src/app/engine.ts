import { Comp, Inputs, PropertyType, Sale, SdltMode } from './models';

/** England and Northern Ireland SDLT, residential, in force from 1 April 2025. Check gov.uk after every Budget. */
export const TAX = {
  bands: [
    [125_000, 0.0],
    [250_000, 0.02],
    [925_000, 0.05],
    [1_500_000, 0.1],
    [Infinity, 0.12],
  ] as [number, number][],
  additionalSurcharge: 0.05,
  firstHomeNilBand: 300_000,
  firstHomeCap: 500_000,
  nonResidentSurcharge: 0.02,
  checkedOn: '20 November 2026',
};

export function sdlt(price: number, mode: SdltMode, nonResident = false): number {
  if (!(price > 0)) return 0;
  let extra = nonResident ? TAX.nonResidentSurcharge : 0;
  if (mode === 'firstHome' && price <= TAX.firstHomeCap) {
    return Math.floor(Math.max(0, price - TAX.firstHomeNilBand) * 0.05 + price * extra + 1e-6);
  }
  if (mode === 'additional') extra += TAX.additionalSurcharge;
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of TAX.bands) {
    if (price > lower) tax += (Math.min(price, upper) - lower) * (rate + extra);
    lower = upper;
  }
  return Math.floor(tax + 1e-6); // HMRC rounds down to the pound
}

export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Lower quartile, median, upper quartile (linear interpolation, inclusive). With under 4 values: min, median, max. */
export function quartiles(values: number[]): [number, number, number] {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return [NaN, NaN, NaN];
  if (v.length < 4) return [v[0], median(v), v[v.length - 1]];
  const at = (p: number) => {
    const pos = p * (v.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  return [at(0.25), at(0.5), at(0.75)];
}

export interface Factor {
  label: string;
  pct: number;
}

/** Percentage adjustments applied to the comparable value. Defaults are judgement calls; the user can override with a custom figure. */
export function adjustmentFactors(i: Inputs, trendPct: number | null): Factor[] {
  const f: Factor[] = [];
  if (i.condition === 'refurbished') f.push({ label: 'Recently refurbished', pct: 3 });
  if (i.condition === 'dated') f.push({ label: 'Dated, needs updating', pct: -4 });
  if (i.condition === 'needsWork') f.push({ label: 'Needs substantial work', pct: -10 });
  if (i.heating === 'electric') f.push({ label: 'Electric heating, no gas central heating', pct: -4 });
  if (i.heating === 'none') f.push({ label: 'No fixed heating', pct: -7 });
  if (i.epc === 'ABC') f.push({ label: 'EPC A to C', pct: 1 });
  if (i.epc === 'E') f.push({ label: 'EPC E', pct: -2 });
  if (i.epc === 'FG') f.push({ label: 'EPC F or G (cannot be let as it stands)', pct: -5 });
  if (i.bathroomDownstairs) f.push({ label: 'Bathroom downstairs', pct: -2 });
  if (i.boxRoom) f.push({ label: 'A bedroom under 6.5 m² (box room)', pct: -4 });
  if (trendPct !== null && trendPct <= -3) f.push({ label: `Local prices falling (${trendPct.toFixed(1)}% in a year)`, pct: -1 });
  if (i.customAdjustPct) f.push({ label: 'Your own adjustment', pct: i.customAdjustPct });
  return f;
}

/**
 * Rough typical internal floor areas in m² by property type in England (English Housing Survey floor-space figures, rounded).
 * Used only when comparables have no floor areas, to scale their prices to the size of the house being valued.
 */
export const TYPICAL_AREA: Record<PropertyType, number> = {
  terraced: 83,
  'semi-detached': 96,
  detached: 150,
  'flat-maisonette': 60,
  other: 90,
};
/** Price does not rise one-for-one with size: a house 10% bigger sells for roughly 8% more. */
const SIZE_ELASTICITY = 0.8;

export interface Valuation {
  /** perM2: like for like on real floor areas. sizeAdjusted: prices scaled by a typical floor area. price: prices only. */
  basis: 'perM2' | 'sizeAdjusted' | 'price';
  sizeFactor: number;
  typicalArea: number | null;
  count: number;
  q: [number, number, number]; // quartiles of price or of price per m2
  adjustPct: number;
  low: number;
  mid: number;
  high: number;
}

export function valuation(comps: Comp[], floorArea: number | null, adjustPct: number, type: PropertyType = 'terraced'): Valuation | null {
  const used = comps.filter((c) => c.selected);
  if (used.length < 3) return null;
  const withArea = used.filter((c) => c.m2 && c.m2 > 0);
  const k = 1 + adjustPct / 100;
  if (floorArea && floorArea > 0 && withArea.length >= 4) {
    const q = quartiles(withArea.map((c) => c.price / (c.m2 as number)));
    return { basis: 'perM2', sizeFactor: 1, typicalArea: null, count: withArea.length, q, adjustPct, low: q[0] * floorArea * k, mid: q[1] * floorArea * k, high: q[2] * floorArea * k };
  }
  const q = quartiles(used.map((c) => c.price));
  if (floorArea && floorArea > 0) {
    const typicalArea = TYPICAL_AREA[type];
    const sizeFactor = Math.min(1.5, Math.max(0.6, Math.pow(floorArea / typicalArea, SIZE_ELASTICITY)));
    const s = k * sizeFactor;
    return { basis: 'sizeAdjusted', sizeFactor, typicalArea, count: used.length, q, adjustPct, low: q[0] * s, mid: q[1] * s, high: q[2] * s };
  }
  return { basis: 'price', sizeFactor: 1, typicalArea: null, count: used.length, q, adjustPct, low: q[0] * k, mid: q[1] * k, high: q[2] * k };
}

/** Median price of same-type sales in the last 12 months against the 12 months before. Null if either side has fewer than 15 sales: small samples swing wildly. */
export function localTrend(sales: Sale[], type: PropertyType, today = new Date()): number | null {
  const cut = (months: number) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };
  const a = cut(12);
  const b = cut(24);
  const pool = sales.filter((s) => s.type === type && s.standard);
  const recent = pool.filter((s) => s.date >= a).map((s) => s.price);
  const prior = pool.filter((s) => s.date < a && s.date >= b).map((s) => s.price);
  if (recent.length < 15 || prior.length < 15) return null;
  return (median(recent) / median(prior) - 1) * 100;
}

export interface Returns {
  price: number;
  sdlt: number;
  buyCosts: number;
  cashIn: number;
  grossYield: number;
  netIncome: number;
  netYield: number;
  loan: number;
  cashInMortgage: number;
  cashflowPm: number;
  roiMortgage: number;
}

export function rentalReturns(price: number, rentPcm: number, i: Inputs): Returns {
  const tax = sdlt(price, i.sdltMode, i.nonResident);
  const buyCosts = tax + i.legal + i.survey + i.initialWorks + i.licenceFee;
  const gross = rentPcm * 12;
  const collected = gross * (1 - i.voidWeeks / 52);
  const running = (collected * i.managementPct) / 100 + (gross * i.maintenancePct) / 100 + i.insurancePa + i.compliancePa;
  const netIncome = collected - running;
  const cashIn = price + buyCosts;
  const loan = i.useMortgage ? (price * i.ltvPct) / 100 : 0;
  const interest = (loan * i.ratePct) / 100;
  const cashInMortgage = price - loan + buyCosts + (i.useMortgage ? i.lenderFees : 0);
  return {
    price,
    sdlt: tax,
    buyCosts,
    cashIn,
    grossYield: (gross / price) * 100,
    netIncome,
    netYield: (netIncome / cashIn) * 100,
    loan,
    cashInMortgage,
    cashflowPm: (netIncome - interest) / 12,
    roiMortgage: ((netIncome - interest) / cashInMortgage) * 100,
  };
}

/** Highest price at which the net yield on cash in still meets the target. */
export function maxPriceForYield(targetPct: number, rentPcm: number, i: Inputs): number {
  let lo = 1_000;
  let hi = 5_000_000;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    if (rentalReturns(mid, rentPcm, i).netYield >= targetPct) lo = mid;
    else hi = mid;
  }
  return lo;
}

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

export interface Ladder {
  open: number;
  target: number;
  ceiling: number;
}

/**
 * Opening offer: 5% under the low end of the evidence, so there is room to move.
 * Target: halfway between the low end and the middle value.
 * Ceiling: the middle value. Above it the comparables no longer support the price.
 * None of the three may sit above the asking price.
 */
export function offerLadder(v: Valuation, asking: number | null): Ladder {
  let open = v.low * 0.95;
  let target = (v.low + v.mid) / 2;
  let ceiling = v.mid;
  if (asking && asking > 0) {
    open = Math.min(open, asking * 0.93);
    target = Math.min(target, asking * 0.97);
    ceiling = Math.min(ceiling, asking);
  }
  const step = v.mid >= 400_000 ? 5_000 : 1_000;
  return { open: roundTo(open, step), target: roundTo(target, step), ceiling: roundTo(ceiling, step) };
}

export interface SellerPosition {
  paid: number;
  paidDate: string;
  yearsHeld: number;
  gainVsAsking: number | null;
  breakEven: number | null; // only estimated for owners of under 3 years
}

export function sellerPosition(history: Sale[], asking: number | null, sellerWorks: number, today = new Date()): SellerPosition | null {
  if (!history.length) return null;
  const last = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
  const years = (today.getTime() - new Date(last.date).getTime()) / (365.25 * 24 * 3600 * 1000);
  let breakEven: number | null = null;
  if (years < 3) {
    const moneyIn = last.price + sdlt(last.price, 'additional') + 1500 + sellerWorks + Math.round(years * 12) * 200;
    breakEven = moneyIn / 0.98; // 2% selling costs
  }
  return {
    paid: last.price,
    paidDate: last.date,
    yearsHeld: years,
    gainVsAsking: asking ? asking - last.price : null,
    breakEven,
  };
}

export function daysOnMarket(listedDate: string, today = new Date()): number | null {
  if (!listedDate) return null;
  const d = new Date(listedDate);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

export type Stance = 'above' | 'top' | 'fair' | 'below';

/** Where the asking price sits against the adjusted comparable range. */
export function askingStance(v: Valuation, asking: number): Stance {
  if (asking > v.high) return 'above';
  if (asking > v.mid * 1.03) return 'top';
  if (asking >= v.low) return 'fair';
  return 'below';
}

export const normaliseHouse = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/^(NO\.?|NUMBER)/, '');

export function isSubject(s: Sale, houseNumber: string, postcode: string): boolean {
  if (!houseNumber) return false;
  return s.postcode.replace(/\s+/g, '') === postcode.replace(/\s+/g, '').toUpperCase() && normaliseHouse(s.paon) === normaliseHouse(houseNumber);
}
