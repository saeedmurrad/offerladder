import { offerLadder, quartiles, rentalReturns, maxPriceForYield, sdlt, valuation, adjustmentFactors, sellerPosition } from './engine';
import { Comp, DEFAULT_INPUTS, Inputs, Sale } from './models';
import { applyPastedAreas, parsePastedAreas } from './paste';

const comp = (price: number, m2: number | null, paon = '1', postcode = 'PE1 2QG'): Comp => ({
  id: `${postcode}|${paon}|${price}`,
  paon,
  saon: '',
  street: 'TEST STREET',
  postcode,
  price,
  date: '2026-05-15',
  type: 'terraced',
  standard: true,
  distanceM: 100,
  selected: true,
  m2,
});

describe('sdlt', () => {
  it('matches the gov.uk worked example: £295,000 standard = £4,750', () => {
    expect(sdlt(295_000, 'standard')).toBe(4_750);
  });
  it('charges nothing up to £125,000 at standard rates', () => {
    expect(sdlt(125_000, 'standard')).toBe(0);
    expect(sdlt(130_000, 'standard')).toBe(100);
  });
  it('adds 5% of the whole price for an additional property', () => {
    expect(sdlt(125_000, 'additional')).toBe(6_250);
    expect(sdlt(136_000, 'additional')).toBe(7_020);
    expect(sdlt(159_950, 'additional')).toBe(8_696);
  });
  it('matches the gov.uk first-time buyer example: £500,000 = £10,000', () => {
    expect(sdlt(500_000, 'firstHome')).toBe(10_000);
    expect(sdlt(150_000, 'firstHome')).toBe(0);
  });
});

describe('valuation and offer ladder', () => {
  // Twelve real terraced-house sales (price, floor area) used in a hand-worked valuation of a 71 m² house.
  const comps = [
    comp(157_000, 71), comp(140_000, 67), comp(136_000, 68), comp(160_000, 68), comp(128_000, 77), comp(130_000, 69),
    comp(150_000, 66), comp(163_000, 63), comp(133_000, 64), comp(136_000, 73), comp(122_500, 58), comp(152_500, 67),
  ];

  it('reproduces the hand analysis: about £131,500 / £140,200 / £151,700 at 71 m² and -6%', () => {
    const v = valuation(comps, 71, -6)!;
    expect(v.basis).toBe('perM2');
    expect(Math.round(v.low / 100) * 100).toBe(131_500);
    expect(Math.round(v.mid / 100) * 100).toBe(140_200);
    expect(Math.round(v.high / 100) * 100).toBe(151_700);
  });

  it('builds the ladder open £125,000, target £136,000, ceiling £140,000', () => {
    const v = valuation(comps, 71, -6)!;
    expect(offerLadder(v, 159_950)).toEqual({ open: 125_000, target: 136_000, ceiling: 140_000 });
  });

  it('never puts an offer above the asking price', () => {
    const v = valuation(comps, 71, 0)!;
    const l = offerLadder(v, 120_000);
    expect(l.ceiling).toBeLessThanOrEqual(120_000);
    expect(l.open).toBeLessThan(l.target);
  });

  it('falls back to prices when floor areas are missing, and needs three comparables', () => {
    expect(valuation(comps.map((c) => ({ ...c, m2: null })), 71, 0)!.basis).toBe('price');
    expect(valuation(comps.slice(0, 2), 71, 0)).toBeNull();
  });

  it('quartiles interpolate inclusively', () => {
    expect(quartiles([1, 2, 3, 4, 5])).toEqual([2, 3, 4]);
  });
});

describe('rental returns', () => {
  const i: Inputs = { ...DEFAULT_INPUTS, rentPcm: 900, initialWorks: 6_000, licenceFee: 908, sdltMode: 'additional' };

  it('reproduces the hand analysis for £125,000 at £900 rent', () => {
    const r = rentalReturns(125_000, 900, i);
    expect(r.cashIn).toBe(140_258);
    expect(Math.round(r.netIncome)).toBe(7_477);
    expect(r.netYield).toBeCloseTo(5.33, 1);
  });

  it('finds the price that meets a target yield', () => {
    const price = maxPriceForYield(5, 900, i);
    expect(rentalReturns(price, 900, i).netYield).toBeCloseTo(5, 2);
    expect(price).toBeGreaterThan(130_000);
    expect(price).toBeLessThan(136_000);
  });
});

describe('adjustments and seller position', () => {
  it('sums to -6% for electric heating, EPC E, downstairs bathroom, refurbished, falling market', () => {
    const i: Inputs = { ...DEFAULT_INPUTS, heating: 'electric', epc: 'E', bathroomDownstairs: true, condition: 'refurbished' };
    expect(adjustmentFactors(i, -4.9).reduce((s, f) => s + f.pct, 0)).toBe(-6);
  });

  it('estimates a break-even only for short ownership', () => {
    const sale = (price: number, date: string): Sale => ({ paon: '1', saon: '', street: 'X', postcode: 'AB1 2CD', price, date, type: 'terraced', standard: true, distanceM: 0 });
    const today = new Date('2026-11-20');
    expect(sellerPosition([sale(34_000, '1999-02-05')], 159_950, 0, today)!.breakEven).toBeNull();
    const flip = sellerPosition([sale(105_000, '2025-09-26')], 150_000, 15_000, today)!;
    expect(flip.breakEven).toBeGreaterThan(127_000);
    expect(flip.breakEven).toBeLessThan(137_500);
  });
});

describe('pasted floor areas', () => {
  it('reads rows copied from a sold-price table and matches them to comparables', () => {
    const text = '328, Clarence Road, PE1 2LQ -\t30 Jul 2026\t£157,000\t71 m²\t£2,211\tTerrace (2 bed)\n22, Henry Street, PE1 2QG\t27 Feb 2026\t£150,000\t66 m² 710 sqft\t£2,272\nnot a property line';
    const pasted = parsePastedAreas(text);
    expect(pasted).toEqual([
      { house: '328', postcode: 'PE1 2LQ', m2: 71 },
      { house: '22', postcode: 'PE1 2QG', m2: 66 },
    ]);
    const { comps, matched } = applyPastedAreas([comp(157_000, null, '328', 'PE1 2LQ'), comp(150_000, null, '22', 'PE1 2QG'), comp(1, null, '9', 'PE1 2QG')], pasted);
    expect(matched).toBe(2);
    expect(comps.map((c) => c.m2)).toEqual([71, 66, null]);
  });
});
