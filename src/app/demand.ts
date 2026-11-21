import { gbp, signed } from './format';
import { AreaSeries, DemandData, PropertyType } from './models';

/** Which way one indicator points for future demand: up is more pressure on prices and rents, down is less. */
export type Signal = 'up' | 'flat' | 'down';

export interface Indicator {
  key: 'prices' | 'sales' | 'population' | 'supply' | 'affordability' | 'earnings' | 'jobs';
  label: string;
  /** Null when the figures needed were not available. */
  signal: Signal | null;
  /** The area's own figure, in words. */
  headline: string;
  /** The same figure for the country, for comparison, and any caveat. */
  detail: string;
  source: string;
}

export interface Outlook {
  indicators: Indicator[];
  scored: number;
  up: number;
  down: number;
  verdict: 'building' | 'mixed' | 'easing' | 'unknown';
}

/**
 * Thresholds for each signal. These are judgement calls, set so that an area has to stand clearly apart
 * from the country before a signal is called up or down.
 */
export const DEMAND_RULES = {
  /** Prices: annual change in percent. At or above `up` is rising in real terms; below `down` is falling. */
  prices: { up: 3, down: 0 },
  /** Sales: 12-month change in sales, in points above or below the country's change. */
  sales: 5,
  /** Population: growth a year, in points above or below the country's rate. */
  population: 0.2,
  /** New homes: residents added per new home sold, as a multiple of the country's figure. */
  supply: { tight: 1.25, plenty: 0.75 },
  /** Affordability: price to earnings, as a multiple of the country's ratio. */
  affordability: { cheap: 0.85, stretched: 1.15 },
  /** Earnings: five-year growth, in points above or below the country's. */
  earnings: 2,
  /** Jobs: change in the claimant rate over a year, in points. */
  jobs: 0.3,
  /** Signals up minus signals down needed to call the outlook building or easing. */
  verdict: 3,
  /** Fewest scored signals for any verdict. */
  minScored: 4,
};

const shiftMonth = (month: string, by: number): string => {
  const [y, m] = month.split('-').map(Number);
  const n = y * 12 + (m - 1) + by;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
};
const pctChange = (now: number, then: number) => (now / then - 1) * 100;
const num = (n: number, digits = 1) => n.toFixed(digits);
const fewerMore = (pct: number) => (Math.abs(pct) < 0.5 ? 'about the same as' : `${Math.abs(pct).toFixed(0)}% ${pct < 0 ? 'fewer' : 'more'} than`);

/** True when the index has its own series for this property type at both ends of the period. */
function hasTypeIndex(s: AreaSeries, type: PropertyType, months: number): boolean {
  const last = s.hpi[s.hpi.length - 1];
  const then = last && s.hpi.find((r) => r.month === shiftMonth(last.month, -months));
  return !!(last?.byType[type] && then?.byType[type]);
}

/** Index change in percent over a number of months up to the latest month, for one property type where the index has it. */
function indexChange(s: AreaSeries, type: PropertyType, months: number, typed = hasTypeIndex(s, type, months)): number | null {
  const last = s.hpi[s.hpi.length - 1];
  if (!last) return null;
  const then = s.hpi.find((r) => r.month === shiftMonth(last.month, -months));
  if (!then) return null;
  if (typed) return pctChange(last.byType[type] as number, then.byType[type] as number);
  return last.index > 0 && then.index > 0 ? pctChange(last.index, then.index) : null;
}

const TYPE_WORDS: Record<PropertyType, string> = { terraced: 'Terraced houses', 'semi-detached': 'Semi-detached houses', detached: 'Detached houses', 'flat-maisonette': 'Flats', other: 'All homes' };

/** Sales in the 12 months up to `end`, and in the 12 months before that. Null if the series does not reach back far enough. */
function salesWindows(s: AreaSeries, end: string): { recent: number; prior: number } | null {
  const start = shiftMonth(end, -23);
  if (!s.hpi.length || s.hpi[0].month > start) return null;
  const split = shiftMonth(end, -11);
  let recent = 0;
  let prior = 0;
  for (const r of s.hpi) {
    if (r.month < start || r.month > end) continue;
    if (r.month >= split) recent += r.sales ?? 0;
    else prior += r.sales ?? 0;
  }
  return prior > 0 ? { recent, prior } : null;
}

const ends = <T>(list: [T, number][]): { first: [T, number]; last: [T, number] } | null => (list.length >= 2 ? { first: list[0], last: list[list.length - 1] } : null);

function prices(d: DemandData, type: PropertyType): Indicator {
  const base = { key: 'prices' as const, label: 'Prices', source: 'UK House Price Index' };
  // Area and country are compared on the same series: the property type's own index only when both have it.
  const typed = (months: number) => hasTypeIndex(d.area, type, months) && hasTypeIndex(d.country, type, months);
  const y1 = indexChange(d.area, type, 12, typed(12));
  if (y1 === null) return { ...base, signal: null, headline: 'No price index for this area.', detail: '' };
  const y5 = indexChange(d.area, type, 60, typed(12) && typed(60));
  const c1 = indexChange(d.country, type, 12, typed(12));
  const c5 = indexChange(d.country, type, 60, typed(12) && typed(60));
  const what = typed(12) ? TYPE_WORDS[type] : 'All homes';
  const signal: Signal = y1 >= DEMAND_RULES.prices.up ? 'up' : y1 < DEMAND_RULES.prices.down ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `${what}: ${signed(y1, 1)} in a year${y5 !== null ? `, ${signed(y5, 0)} in five years` : ''}.`,
    detail: c1 !== null ? `${d.countryName}: ${signed(c1, 1)}${c5 !== null ? ` and ${signed(c5, 0)}` : ''}.` : '',
  };
}

function sales(d: DemandData): Indicator {
  const base = { key: 'sales' as const, label: 'Sales activity', source: 'UK House Price Index' };
  // The newest months have no sales count yet, so stop at the last month the country has one.
  const end = [...d.country.hpi].reverse().find((r) => r.sales !== null)?.month;
  const a = end ? salesWindows(d.area, end) : null;
  const c = end ? salesWindows(d.country, end) : null;
  if (!a || !c) return { ...base, signal: null, headline: 'No sales counts for this area.', detail: '' };
  const areaChange = pctChange(a.recent, a.prior);
  const countryChange = pctChange(c.recent, c.prior);
  const gap = areaChange - countryChange;
  const signal: Signal = gap >= DEMAND_RULES.sales ? 'up' : gap <= -DEMAND_RULES.sales ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `${a.recent.toLocaleString('en-GB')} sales in the latest 12 months on record, ${fewerMore(areaChange)} the 12 before.`,
    detail: `${d.countryName}: ${fewerMore(countryChange)} the 12 before. Recent sales are still being registered, which lowers both figures, so the area is judged against the country.`,
  };
}

function population(d: DemandData): Indicator {
  const base = { key: 'population' as const, label: 'Population', source: 'ONS mid-year estimates' };
  const a = ends(d.area.population);
  const c = ends(d.country.population);
  if (!a || !c) return { ...base, signal: null, headline: 'No population estimates for this area.', detail: '' };
  const yearly = (e: { first: [number, number]; last: [number, number] }) => (Math.pow(e.last[1] / e.first[1], 1 / (e.last[0] - e.first[0])) - 1) * 100;
  const area = yearly(a);
  const country = yearly(c);
  const signal: Signal = area >= country + DEMAND_RULES.population ? 'up' : area <= country - DEMAND_RULES.population || area < 0 ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `${signed(area, 1)} a year from ${a.first[0]} to ${a.last[0]} (${(a.last[1] - a.first[1] > 0 ? '+' : '') + (a.last[1] - a.first[1]).toLocaleString('en-GB')} residents).`,
    detail: `${d.countryName}: ${signed(country, 1)} a year.`,
  };
}

/** New homes sold between the two population estimates, which are taken at the end of June. */
function newHomes(s: AreaSeries, fromYear: number, toYear: number): number | null {
  const start = `${fromYear}-07`;
  const end = `${toYear}-06`;
  if (!s.hpi.length || s.hpi[0].month > start) return null;
  return s.hpi.filter((r) => r.month >= start && r.month <= end).reduce((sum, r) => sum + (r.newBuild ?? 0), 0);
}

function supply(d: DemandData): Indicator {
  const base = { key: 'supply' as const, label: 'New homes against new residents', source: 'UK House Price Index, ONS' };
  const a = ends(d.area.population);
  const c = ends(d.country.population);
  const built = a ? newHomes(d.area, a.first[0], a.last[0]) : null;
  const countryBuilt = c ? newHomes(d.country, c.first[0], c.last[0]) : null;
  if (!a || !c || built === null || !countryBuilt) return { ...base, signal: null, headline: 'No new-home counts for this area.', detail: '' };
  const added = a.last[1] - a.first[1];
  const countryRatio = (c.last[1] - c.first[1]) / countryBuilt;
  const caveat = 'Counts new homes sold on the open market only, not housing-association or build-to-rent homes.';
  const period = `${a.first[0]} to ${a.last[0]}`;
  if (added <= 0) {
    return { ...base, signal: 'down', headline: `The population fell while ${built.toLocaleString('en-GB')} new homes were sold, ${period}.`, detail: caveat };
  }
  if (built === 0) {
    return { ...base, signal: 'up', headline: `${added.toLocaleString('en-GB')} more residents and no new homes sold, ${period}.`, detail: caveat };
  }
  const ratio = added / built;
  const rel = countryRatio > 0 ? ratio / countryRatio : null;
  const signal: Signal | null = rel === null ? null : rel >= DEMAND_RULES.supply.tight ? 'up' : rel <= DEMAND_RULES.supply.plenty ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `${num(ratio)} more residents for each new home sold, ${period}.`,
    detail: `${countryRatio > 0 ? `${d.countryName}: ${num(countryRatio)}. ` : ''}${caveat}`,
  };
}

function affordability(d: DemandData): Indicator {
  const base = { key: 'affordability' as const, label: 'Price against earnings', source: 'UK House Price Index, ONS earnings survey' };
  const ratio = (s: AreaSeries) => {
    const price = s.hpi[s.hpi.length - 1]?.average;
    const pay = s.earnings[s.earnings.length - 1]?.[1];
    return price && pay ? { price, pay, ratio: price / pay } : null;
  };
  const a = ratio(d.area);
  const c = ratio(d.country);
  if (!a || !c) return { ...base, signal: null, headline: 'No earnings figure for this area.', detail: '' };
  const rel = a.ratio / c.ratio;
  // Cheap against earnings leaves room for prices to rise; stretched leaves little.
  const signal: Signal = rel <= DEMAND_RULES.affordability.cheap ? 'up' : rel >= DEMAND_RULES.affordability.stretched ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `The average home costs ${num(a.ratio)} times full-time pay (${gbp(a.price)} against ${gbp(a.pay)} a year).`,
    detail: `${d.countryName}: ${num(c.ratio)} times. Cheaper than the country leaves room to rise; dearer leaves little.`,
  };
}

function earnings(d: DemandData): Indicator {
  const base = { key: 'earnings' as const, label: 'Earnings', source: 'ONS earnings survey' };
  const a = ends(d.area.earnings);
  const c = ends(d.country.earnings);
  if (!a || !c) return { ...base, signal: null, headline: 'No earnings figures for this area.', detail: '' };
  const area = pctChange(a.last[1], a.first[1]);
  const country = pctChange(c.last[1], c.first[1]);
  const signal: Signal = area >= country + DEMAND_RULES.earnings ? 'up' : area <= country - DEMAND_RULES.earnings ? 'down' : 'flat';
  return {
    ...base,
    signal,
    headline: `Median full-time pay ${signed(area, 0)} from ${a.first[0]} to ${a.last[0]}, to ${gbp(a.last[1])}.`,
    detail: `${d.countryName}: ${signed(country, 0)}, to ${gbp(c.last[1])}.`,
  };
}

function jobs(d: DemandData): Indicator {
  const base = { key: 'jobs' as const, label: 'Jobs', source: 'ONS claimant count' };
  const a = ends(d.area.claimants);
  const c = ends(d.country.claimants);
  if (!a) return { ...base, signal: null, headline: 'No claimant figures for this area.', detail: '' };
  const change = a.last[1] - a.first[1];
  // Fewer people out of work means more people able to rent or buy.
  const signal: Signal = change <= -DEMAND_RULES.jobs ? 'up' : change >= DEMAND_RULES.jobs ? 'down' : 'flat';
  const moved = Math.abs(change) < 0.05 ? 'unchanged over a year' : `${change > 0 ? 'up' : 'down'} ${num(Math.abs(change))} points in a year`;
  return {
    ...base,
    signal,
    headline: `${num(a.last[1])}% of working-age residents claim out-of-work benefits, ${moved}.`,
    detail: c ? `${d.countryName}: ${num(c.last[1])}%.` : '',
  };
}

/**
 * Reads the pressure on a council area's housing market from seven public measures.
 * It describes the area, not one house, and it is a reading of where things stand, not a forecast.
 */
export function demandOutlook(d: DemandData, type: PropertyType): Outlook {
  const indicators = [prices(d, type), sales(d), population(d), supply(d), affordability(d), earnings(d), jobs(d)];
  const scored = indicators.filter((i) => i.signal !== null).length;
  const up = indicators.filter((i) => i.signal === 'up').length;
  const down = indicators.filter((i) => i.signal === 'down').length;
  const net = up - down;
  const verdict = scored < DEMAND_RULES.minScored ? 'unknown' : net >= DEMAND_RULES.verdict ? 'building' : net <= -DEMAND_RULES.verdict ? 'easing' : 'mixed';
  return { indicators, scored, up, down, verdict };
}
