import { Inputs, PropertyType, Sale } from './models';

export interface PastSale {
  /** 1 to 12, or null when the listing only gives a year. */
  month: number | null;
  year: number;
  price: number;
}

/** What could be read from the text of a property listing page. Every field is optional. */
export interface ParsedListing {
  source: 'Zoopla' | 'Rightmove' | 'OnTheMarket' | null;
  asking: number | null;
  houseNumber: string | null;
  street: string | null;
  /** Address parts after the street, most specific first, without the postcode. */
  places: string[];
  outcode: string | null;
  postcode: string | null;
  bedrooms: number | null;
  propertyType: PropertyType | null;
  listedDate: string | null; // yyyy-mm-dd
  floorArea: number | null; // m²
  epc: Inputs['epc'] | null;
  heating: Inputs['heating'] | null;
  condition: Inputs['condition'] | null;
  bathroomDownstairs: boolean;
  tenure: 'Freehold' | 'Leasehold' | null;
  chainFree: boolean;
  /** offStreet: a drive, garage or allocated space is mentioned. onStreet: only street or permit parking is. */
  parking: 'offStreet' | 'onStreet' | null;
  agentRent: number | null;
  pastSales: PastSale[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const STREET_WORD =
  /\b(road|street|lane|avenue|close|drive|way|grove|court|place|crescent|terrace|gardens?|walk|row|hill|park|square|mews|rise|view|garth|boulevard|green|gate|drove|end|croft|meadows?|fields?|parade|broadway|causeway|wharf|quay|common|chase|vale|bank|side)\b/i;
const OUTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*(\d[A-Z]{2}))?$/i;
const money = (s: string) => Number(s.replace(/[£,\s]/g, ''));

function propertyType(text: string): PropertyType | null {
  const t = text.toLowerCase();
  if (/\b(flat|apartment|maisonette|studio)\b/.test(t)) return 'flat-maisonette';
  if (/\b(end[\s-]of[\s-]terrace|end[\s-]terraced?|mid[\s-]terraced?|terraced?|town\s?house)\b/.test(t)) return 'terraced';
  if (/\bsemi[\s-]detached\b/.test(t)) return 'semi-detached';
  if (/\b(detached|bungalow)\b/.test(t)) return 'detached';
  return null;
}

function splitAddress(line: string) {
  let rest = line.trim().replace(/[.]/g, '');
  let outcode: string | null = null;
  let postcode: string | null = null;
  const pc = rest.match(OUTCODE);
  if (pc) {
    outcode = pc[1].toUpperCase();
    if (pc[2]) postcode = `${outcode} ${pc[2].toUpperCase()}`;
    rest = rest.slice(0, pc.index).replace(/[,\s]+$/, '');
  }
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  let street = parts[0] ?? null;
  let houseNumber: string | null = null;
  const num = street?.match(/^(\d+[A-Z]?)\s+(.+)$/i);
  if (num) {
    houseNumber = num[1].toUpperCase();
    street = num[2];
  }
  return { houseNumber, street, places: parts.slice(1), outcode, postcode };
}

/** A line that reads like "Burghley Road, Peterborough PE1": short, has a comma or postcode, and a street word up front. */
function looksLikeAddress(line: string): boolean {
  if (line.length > 90 || /£|\d{2}\/\d{2}\/\d{4}/.test(line)) return false;
  const first = line.split(',')[0];
  return STREET_WORD.test(first) && (line.includes(',') || OUTCODE.test(line.trim())) && first.split(/\s+/).length <= 6;
}

/**
 * The address inside a listing's headline, which is all a browser's Share button sends. The three sites word it differently:
 *   Zoopla       "Burghley Road, Peterborough, Cambridgeshire PE1, 2 bed end terrace house for sale, £150,000 - Zoopla"
 *   Rightmove    "3 bedroom detached bungalow for sale in Bowmore, PA43"
 *   OnTheMarket  "Western Avenue, Peterborough 4 bed semi-detached house for sale - £270,000"
 */
export function headlineAddress(line: string): string | null {
  if (!/\bfor sale\b/i.test(line)) return null;
  const text = line
    .replace(/\s[-|–]\s*(?:zoopla|rightmove|onthemarket)\b.*$/i, '')
    .replace(/[\s,–-]*£\s?[\d,]+.*$/, '')
    .trim();
  const after = /\bfor sale in\s+(.+)$/i.exec(text)?.[1];
  const before = /^(.+?),?\s+\d{1,2}\s*bed/i.exec(text)?.[1];
  const address = (after ?? before ?? '').replace(/[\s,]+$/, '');
  if (!address || address.length > 110) return null;
  // It must read like a place: a street word up front, or a postcode district at the end.
  return STREET_WORD.test(address.split(',')[0]) || OUTCODE.test(address) ? address : null;
}

/**
 * Reads the text of a listing page that the user has copied and pasted.
 * Written against Zoopla and Rightmove detail pages; anything it cannot find stays null.
 */
export function parseListing(text: string): ParsedListing {
  // A shared headline arrives with its link on the end; the link says nothing and gets in the way of reading the line.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\bhttps?:\/\/\S+/gi, '').trim()).filter(Boolean);
  const flat = lines.join('\n');
  const out: ParsedListing = {
    source: /zoopla/i.test(text) ? 'Zoopla' : /rightmove/i.test(text) ? 'Rightmove' : /onthemarket/i.test(text) ? 'OnTheMarket' : null,
    asking: null,
    houseNumber: null,
    street: null,
    places: [],
    outcode: null,
    postcode: null,
    bedrooms: null,
    propertyType: null,
    listedDate: null,
    floorArea: null,
    epc: null,
    heating: null,
    condition: null,
    bathroomDownstairs: false,
    tenure: null,
    chainFree: false,
    parking: null,
    agentRent: null,
    pastSales: [],
  };

  // Asking price: the first large £ figure that is not a rent.
  const priceIndex = lines.findIndex((l) => /^(?:guide price|offers (?:over|in excess of|in the region of)|oieo|oiro|from)?\s*£\s?[\d,]{5,}$/i.test(l) || /^£\s?[\d,]{5,}\b(?!\s*(?:pcm|pw|per))/i.test(l));
  if (priceIndex >= 0) out.asking = money(lines[priceIndex].match(/£\s?[\d,]{5,}/)![0]);
  else {
    // A shared headline has the price in the middle of its one line: "... house for sale, £150,000 - Zoopla".
    const inHeadline = lines.find((l) => /\bfor sale\b/i.test(l))?.match(/£\s?([\d,]{5,})(?!\s*(?:pcm|pw|per))/i);
    if (inHeadline) out.asking = money(inHeadline[1]);
  }

  // Address: Zoopla puts it under the "... for sale" headline, Rightmove just above the price.
  const headline = lines.findIndex((l) => /\bfor sale\b/i.test(l) && /\bbed|house|flat|bungalow|maisonette|studio/i.test(l) && l.length < 90);
  const candidates = [headline >= 0 ? lines[headline + 1] : null, priceIndex > 0 ? lines[priceIndex - 1] : null, ...lines.slice(0, 120)].filter((l): l is string => !!l);
  const addressLine = candidates.find(looksLikeAddress);
  const fromHeadline = addressLine ? null : lines.map(headlineAddress).find((a): a is string => !!a);
  if (addressLine ?? fromHeadline) Object.assign(out, splitAddress((addressLine ?? fromHeadline) as string));

  // Type and bedrooms.
  const typeLabel = lines.findIndex((l) => /^property type$/i.test(l));
  out.propertyType = propertyType(headline >= 0 ? lines[headline] : (lines.find((l) => /\bfor sale\b/i.test(l)) ?? '')) ?? (typeLabel >= 0 ? propertyType(lines[typeLabel + 1] ?? '') : null) ?? propertyType(lines.slice(0, 60).join(' '));
  const bedLabel = lines.findIndex((l) => /^bedrooms$/i.test(l));
  const bedText = flat.match(/\b(\d{1,2})\s*bed(?:room)?s?\b/i);
  if (bedLabel >= 0 && /^\d{1,2}$/.test(lines[bedLabel + 1] ?? '')) out.bedrooms = Number(lines[bedLabel + 1]);
  else if (bedText) out.bedrooms = Number(bedText[1]);

  // Date first listed. "Reduced on" is a price cut, not the listing date, so it is ignored.
  const added = flat.match(/\b(?:added|listed) on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (added) out.listedDate = `${added[3]}-${added[2].padStart(2, '0')}-${added[1].padStart(2, '0')}`;

  // Floor area: square feet or square metres, never room dimensions such as "3.6m x 3.7m".
  const sqft = flat.match(/\b([\d,]{3,6})\s*sq\.?\s*ft\b/i);
  const sqm = flat.match(/\b(\d{2,4}(?:\.\d+)?)\s*(?:sq\.?\s*m\b|sqm\b|m²)/i);
  if (sqm) out.floorArea = Math.round(Number(sqm[1]));
  else if (sqft) out.floorArea = Math.round(money(sqft[1]) / 10.764);

  const epc = flat.match(/\bEPC(?:\s+rating)?\s*[:\-]?\s*([A-G])\b/i);
  if (epc) {
    const g = epc[1].toUpperCase();
    out.epc = 'ABC'.includes(g) ? 'ABC' : g === 'D' ? 'D' : g === 'E' ? 'E' : 'FG';
  }
  if (/\bgas (?:fired |radiator )?central heating|\bgas c\/?h\b|\bcombi(?:nation)? boiler/i.test(flat)) out.heating = 'gas';
  else if (/\belectric (?:central )?heat(?:ing|ers?)|\bstorage heat(?:ing|ers?)/i.test(flat)) out.heating = 'electric';

  if (/\bin need of (?:full |complete |total )?(?:refurbishment|renovation)|\brequires? (?:full |complete )?(?:refurbishment|renovation)|\bneed of recommission/i.test(flat)) out.condition = 'needsWork';
  else if (/\bin need of (?:some )?(?:modernis|updating|improvement)|\brequires? (?:some )?(?:modernis|updating)/i.test(flat)) out.condition = 'dated';
  else if (/\b(?:recently |newly |fully )?(?:refurbished|renovated)\b|\bnewly (?:decorated|fitted)|\bre-?fitted kitchen/i.test(flat)) out.condition = 'refurbished';

  out.bathroomDownstairs = /\b(?:downstairs|ground[\s-]floor) bath(?:room)?\b/i.test(flat);
  out.tenure = /\bleasehold\b/i.test(flat) && !/\bfreehold\b/i.test(flat) ? 'Leasehold' : /\bfreehold\b/i.test(flat) ? 'Freehold' : null;
  out.chainFree = /\b(?:no (?:onward |upward )?chain|chain[\s-]free)\b/i.test(flat);

  if (/\b(?:drive ?way|off[\s-]?(?:street|road) parking|garage|car ?port|allocated (?:parking|space)|private parking|parking space|parking for \w+ (?:cars?|vehicles?))\b/i.test(flat) && !/\bno (?:off[\s-]?(?:street|road) parking|garage|drive ?way)\b/i.test(flat)) out.parking = 'offStreet';
  else if (/\b(?:on[\s-]?(?:street|road) parking|permit parking|residents'? (?:permit|parking)|street parking|no (?:off[\s-]?(?:street|road) )?parking)\b/i.test(flat)) out.parking = 'onStreet';

  const rent = flat.match(/£\s?([\d,]{3,5})\s*(?:pcm|per calendar month|per month|p\/m)/i);
  if (rent) out.agentRent = money(rent[1]);

  // Past sales: "Sold  February 1999  £34,000" (Zoopla timeline) or "2005  £95,000" (Rightmove sale history).
  const seen = new Set<string>();
  const add = (month: number | null, year: number, price: number) => {
    const key = `${year}-${price}`;
    if (price >= 5_000 && year >= 1995 && !seen.has(key)) {
      seen.add(key);
      out.pastSales.push({ month, year, price });
    }
  };
  for (const m of flat.matchAll(/\bSold\s+([A-Za-z]+)\s+(\d{4})\s+£\s?([\d,]+)/g)) add(MONTHS.indexOf(m[1].toLowerCase()) + 1 || null, Number(m[2]), money(m[3]));
  const history = flat.search(/property sale history|sale history|sold prices? history/i);
  if (history >= 0) for (const m of flat.slice(history, history + 600).matchAll(/\b((?:19|20)\d{2})\s+£\s?([\d,]+)/g)) add(null, Number(m[1]), money(m[2]));

  return out;
}

export interface PastedLink {
  url: string;
  portal: ParsedListing['source'];
}

/**
 * Spots a web address pasted in place of the listing text: a link on its own, or a link with a few words around it
 * as a phone's Share button sends ("Check out this property on Zoopla https://...").
 * Real listing text is long and has a price in it, so it never matches.
 */
export function pastedLink(text: string): PastedLink | null {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9-]+\.)*(?:zoopla\.co\.uk|rightmove\.co\.uk|onthemarket\.com)\/[^\s<>"']*/i);
  if (!found) return null;
  const rest = text.replace(found[0], ' ').trim();
  if (rest.length > 120 || /£\s?\d/.test(rest)) return null;
  const url = (/^https?:\/\//i.test(found[0]) ? found[0] : `https://${found[0]}`).replace(/[.,;:!?)\]]+$/, '');
  try {
    const host = new URL(url).hostname.toLowerCase();
    const portal = /(^|\.)zoopla\.co\.uk$/.test(host) ? 'Zoopla' : /(^|\.)rightmove\.co\.uk$/.test(host) ? 'Rightmove' : /(^|\.)onthemarket\.com$/.test(host) ? 'OnTheMarket' : null;
    return { url, portal };
  } catch {
    return null;
  }
}

export interface HouseMatch {
  houseNumber: string;
  postcode: string;
  sale: PastSale;
}

/**
 * Finds the exact house by matching the listing's past sale prices against Land Registry sales on the same street.
 * Returns a match only when every matching sale points at one single address.
 */
export function matchHouse(pastSales: PastSale[], streetSales: Sale[]): HouseMatch | null {
  const hits = new Map<string, HouseMatch>();
  for (const past of pastSales) {
    for (const s of streetSales) {
      const [y, m] = s.date.split('-').map(Number);
      if (s.price !== past.price || y !== past.year || (past.month !== null && Math.abs(m - past.month) > 1)) continue;
      const number = [s.saon, s.paon].filter(Boolean).join(' ');
      const key = `${s.postcode}|${number}`;
      const prior = hits.get(key);
      // Quote the most recent matching sale.
      if (!prior || past.year > prior.sale.year) hits.set(key, { houseNumber: number, postcode: s.postcode, sale: past });
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** The postcodes on a street, busiest first, for when the exact house cannot be identified. */
export function streetPostcodes(streetSales: Sale[]): { postcode: string; sales: number }[] {
  const counts = new Map<string, number>();
  for (const s of streetSales) counts.set(s.postcode, (counts.get(s.postcode) ?? 0) + 1);
  return [...counts.entries()].map(([postcode, sales]) => ({ postcode, sales })).sort((a, b) => b.sales - a.sales);
}
