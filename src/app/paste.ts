import { normaliseHouse } from './engine';
import { Comp } from './models';

export interface PastedArea {
  house: string;
  postcode: string;
  m2: number;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/**
 * Reads floor areas out of pasted text, one property per line.
 * Works with rows copied from a sold-price table such as Housemetric's
 * ("12, Park Road, M14 5AB   30 Jul 2026   £157,000   71 m²   £2,211   Terrace (2 bed)")
 * and with hand-typed lines like "12 M14 5AB 71 m2".
 */
export function parsePastedAreas(text: string): PastedArea[] {
  const out: PastedArea[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const pc = line.match(POSTCODE);
    const area = line.match(/(\d{2,4}(?:\.\d+)?)\s*(?:m²|m2\b|sqm\b|sq\s?m\b)/i);
    const house = line.match(/^\s*((?:flat\s+)?\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?)/i);
    if (!pc || !area || !house) continue;
    out.push({ house: normaliseHouse(house[1]), postcode: `${pc[1]} ${pc[2]}`.toUpperCase(), m2: Number(area[1]) });
  }
  return out;
}

/** Fills m² on comps whose house number and postcode match a pasted row. Returns the updated list and how many matched. */
export function applyPastedAreas(comps: Comp[], pasted: PastedArea[]): { comps: Comp[]; matched: number } {
  const index = new Map(pasted.map((p) => [`${p.postcode}|${p.house}`, p.m2]));
  let matched = 0;
  const next = comps.map((c) => {
    const m2 = index.get(`${c.postcode}|${normaliseHouse(c.paon)}`);
    if (m2 === undefined || c.saon) return c;
    matched++;
    return { ...c, m2 };
  });
  return { comps: next, matched };
}
