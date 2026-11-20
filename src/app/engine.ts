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
/** Rough typical floor areas in m² by type and bedroom count, for when a listing gives bedrooms but no floor area. */
const AREA_BY_BEDS: Record<PropertyType, number[]> = {
  // index = bedrooms (0 = studio)
  terraced: [45, 50, 68, 85, 110, 135],
  'semi-detached': [50, 55, 70, 90, 115, 145],
  detached: [60, 65, 80, 105, 140, 190],
  'flat-maisonette': [32, 46, 61, 80, 100, 120],
  other: [45, 50, 68, 88, 115, 145],
};

/** A floor area to assume from the bedroom count, or null when bedrooms are not known. */
export function assumedFloorArea(type: PropertyType, bedrooms: number | null): number | null {
  if (bedrooms === null || bedrooms < 0) return null;
  const table = AREA_BY_BEDS[type];
  return table[Math.min(Math.round(bedrooms), table.length - 1)];
}

/** Price does not rise one-for-one with size: a house 10% bigger sells for roughly 8% more. */
const SIZE_ELASTICITY = 0.8;

const yearsSince = (date: string, today: Date) => Math.max(0, (today.getTime() - new Date(date).getTime()) / (365.25 * 24 * 3600 * 1000));

/**
 * The house's own last ordinary sale, brought to today's prices.
 * A recent sale of the house itself is better evidence of its value than any neighbour's sale.
 */
export interface OwnSale {
  paid: number;
  date: string;
  years: number;
  /** The price paid, moved by the local house price index since the sale. Equal to `paid` when no index was available. */
  indexed: number;
  /** Index movement since the sale in percent, or null when no index was available. */
  movePct: number | null;
  /** Share of the value taken from this sale, from 0.9 for a sale today down to nothing. */
  weight: number;
}

/**
 * How much the house's own last sale counts: 90% for a sale today, falling 12 points a year, nothing after 7.5 years.
 * An old sale says little: the house, the street and the market have all moved on.
 */
export function ownSaleWeight(years: number): number {
  return Math.max(0, 90 - 12 * Math.max(0, years)) / 100;
}

/** indexRatio is local prices today over local prices in the month of the sale, or null if not known. */
export function ownSale(history: Sale[], indexRatio: number | null, today = new Date()): OwnSale | null {
  const last = history.filter((s) => s.standard && s.price > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return null;
  const years = yearsSince(last.date, today);
  const weight = ownSaleWeight(years);
  if (weight <= 0) return null;
  const known = indexRatio !== null && indexRatio > 0;
  return { paid: last.price, date: last.date, years, indexed: last.price * (known ? indexRatio : 1), movePct: known ? (indexRatio - 1) * 100 : null, weight };
}

/** With no usable nearby sales, the range around the house's own sale. */
const OWN_ONLY_SPREAD = 0.05;

export interface Valuation {
  /** perM2: like for like on real floor areas. sizeAdjusted: prices scaled by a typical floor area. price: prices only. ownSale: the house's own last sale alone. */
  basis: 'perM2' | 'sizeAdjusted' | 'price' | 'ownSale';
  sizeFactor: number;
  typicalArea: number | null;
  count: number;
  q: [number, number, number]; // quartiles of price or of price per m2
  adjustPct: number;
  /** The middle value from nearby sales alone, after adjustments. Null when there were too few to use. */
  compsMid: number | null;
  /** The house's own last sale, when it was used in the value. */
  own: OwnSale | null;
  low: number;
  mid: number;
  high: number;
}

function compsValuation(comps: Comp[], floorArea: number | null, adjustPct: number, type: PropertyType): Valuation | null {
  const used = comps.filter((c) => c.selected);
  if (used.length < 3) return null;
  const withArea = used.filter((c) => c.m2 && c.m2 > 0);
  const k = 1 + adjustPct / 100;
  const out = (basis: Valuation['basis'], count: number, q: [number, number, number], s: number, sizeFactor = 1, typicalArea: number | null = null): Valuation => ({
    basis,
    sizeFactor,
    typicalArea,
    count,
    q,
    adjustPct,
    compsMid: q[1] * s,
    own: null,
    low: q[0] * s,
    mid: q[1] * s,
    high: q[2] * s,
  });
  if (floorArea && floorArea > 0 && withArea.length >= 4) {
    return out('perM2', withArea.length, quartiles(withArea.map((c) => c.price / (c.m2 as number))), floorArea * k);
  }
  const q = quartiles(used.map((c) => c.price));
  if (floorArea && floorArea > 0) {
    const typicalArea = TYPICAL_AREA[type];
    const sizeFactor = Math.min(1.5, Math.max(0.6, Math.pow(floorArea / typicalArea, SIZE_ELASTICITY)));
    return out('sizeAdjusted', used.length, q, k * sizeFactor, sizeFactor, typicalArea);
  }
  return out('price', used.length, q, k);
}

/**
 * Value range from nearby sales, pulled towards the house's own last sale when there is a recent one.
 * The more that sale counts, the narrower the range: a scatter of unlike neighbours must not drag the low end down.
 * The condition adjustments apply to the nearby sales only: the house's own sale price already reflects the house.
 */
export function valuation(comps: Comp[], floorArea: number | null, adjustPct: number, type: PropertyType = 'terraced', own: OwnSale | null = null): Valuation | null {
  const base = compsValuation(comps, floorArea, adjustPct, type);
  if (!own) return base;
  if (!base) {
    return {
      basis: 'ownSale',
      sizeFactor: 1,
      typicalArea: null,
      count: 0,
      q: [NaN, NaN, NaN],
      adjustPct: 0,
      compsMid: null,
      own,
      low: own.indexed * (1 - OWN_ONLY_SPREAD),
      mid: own.indexed,
      high: own.indexed * (1 + OWN_ONLY_SPREAD),
    };
  }
  const w = own.weight;
  const mid = base.mid * (1 - w) + own.indexed * w;
  // The width of the range is blended the same way: as wide as the nearby sales when they carry the value,
  // down to 5% either side when the house's own sale does.
  const low = mid * ((base.low / base.mid) * (1 - w) + (1 - OWN_ONLY_SPREAD) * w);
  const high = mid * ((base.high / base.mid) * (1 - w) + (1 + OWN_ONLY_SPREAD) * w);
  return { ...base, own, low, mid, high };
}

/** How far nearby sales alone sit from the house's own indexed sale, in percent. Null when either is missing. */
export function evidenceGapPct(v: Valuation): number | null {
  return v.own && v.compsMid ? (v.compsMid / v.own.indexed - 1) * 100 : null;
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
  const years = yearsSince(last.date, today);
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
