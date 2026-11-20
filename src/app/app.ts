import { Component, computed, effect, inject, signal } from '@angular/core';
import { DataService } from './data.service';
import {
  adjustmentFactors,
  askingStance,
  daysOnMarket,
  isSubject,
  normaliseHouse,
  localTrend,
  maxPriceForYield,
  offerLadder,
  quartiles,
  rentalReturns,
  sdlt,
  sellerPosition,
  TAX,
  valuation,
} from './engine';
import { AreaData, Comp, DEFAULT_INPUTS, Geo, Inputs, PropertyType, Sale, SdltMode, Snapshot } from './models';
import { applyPastedAreas, parsePastedAreas } from './paste';
import { CompareView } from './ui/compare-view';
import { GlossaryView } from './ui/glossary-view';
import { Icon } from './ui/icon';
import { ValueBar } from './ui/value-bar';

const STORE_KEY = 'property-offer-analyser.inputs.v1';
const THEME_KEY = 'property-offer-analyser.theme';
const SAVED_KEY = 'property-offer-analyser.saved.v1';
const MAX_SAVED = 3;
type View = 'analyse' | 'compare' | 'glossary';

function loadSaved(): Snapshot[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(list) ? list.slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}
type Theme = 'light' | 'dark';

function loadTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function loadInputs(): Inputs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_INPUTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: start from defaults */
  }
  return { ...DEFAULT_INPUTS };
}

@Component({
  selector: 'app-root',
  imports: [Icon, ValueBar, CompareView, GlossaryView],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly data = inject(DataService);

  readonly inputs = signal<Inputs>(loadInputs());
  readonly status = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  readonly error = signal('');
  readonly geo = signal<Geo | null>(null);
  readonly nearbySales = signal<Sale[]>([]);
  readonly history = signal<Sale[]>([]);
  readonly comps = signal<Comp[]>([]);
  readonly area = signal<AreaData | null>(null);
  readonly pasteText = signal('');
  readonly pasteNote = signal('');
  readonly taxCheckedOn = TAX.checkedOn;
  readonly view = signal<View>('analyse');
  readonly saved = signal<Snapshot[]>(loadSaved());
  readonly saveNote = signal('');
  readonly views: { key: View; label: string }[] = [
    { key: 'analyse', label: 'Analyse' },
    { key: 'compare', label: 'Compare' },
    { key: 'glossary', label: 'Glossary' },
  ];
  readonly theme = signal<Theme | null>(loadTheme());
  readonly isDark = computed(() => this.theme() === 'dark' || (this.theme() === null && window.matchMedia?.('(prefers-color-scheme: dark)').matches));

  readonly propertyTypes: { key: PropertyType; label: string }[] = [
    { key: 'terraced', label: 'Terraced' },
    { key: 'semi-detached', label: 'Semi-detached' },
    { key: 'detached', label: 'Detached' },
    { key: 'flat-maisonette', label: 'Flat' },
  ];
  readonly sections = [
    { id: 'offer', label: 'Offer' },
    { id: 'house', label: 'This house' },
    { id: 'comps', label: 'Comparables' },
    { id: 'value', label: 'Value' },
    { id: 'returns', label: 'Returns' },
    { id: 'duty', label: 'Stamp duty' },
    { id: 'area', label: 'Area' },
    { id: 'checks', label: 'Checks' },
  ];

  readonly sdltModes: { key: SdltMode; label: string }[] = [
    { key: 'firstHome', label: 'First home to live in' },
    { key: 'standard', label: 'Only property you will own' },
    { key: 'additional', label: 'Additional property or company' },
  ];

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.inputs()));
      } catch {
        /* storage unavailable: nothing to save */
      }
    });
    effect(() => {
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(this.saved()));
      } catch {
        /* storage unavailable: the shortlist lasts for this visit only */
      }
    });
    effect(() => {
      const t = this.theme();
      if (t) document.documentElement.dataset['theme'] = t;
      else delete document.documentElement.dataset['theme'];
      try {
        if (t) localStorage.setItem(THEME_KEY, t);
      } catch {
        /* storage unavailable: theme lasts for this visit only */
      }
    });
  }

  // ---- comparison shortlist ----
  readonly currentId = computed(() => {
    const g = this.geo();
    return g ? `${g.postcode}|${normaliseHouse(this.inputs().houseNumber)}` : '';
  });
  readonly isSaved = computed(() => this.saved().some((s) => s.id === this.currentId()));

  /** Freeze the current analysis and add it to the comparison (or update it if already there). */
  saveCurrent(): void {
    const g = this.geo();
    const v = this.value();
    const l = this.ladder();
    if (!g || !v || !l) return;
    const i = this.inputs();
    const atTarget = rentalReturns(l.target, i.rentPcm ?? 0, i);
    const seller = this.seller();
    const a = this.area();
    const name = [i.houseNumber, i.street].filter(Boolean).join(' ');
    const snap: Snapshot = {
      id: this.currentId(),
      label: name ? `${name}, ${g.postcode}` : g.postcode,
      savedAt: new Date().toISOString(),
      inputs: { ...i },
      district: g.district,
      basis: v.basis,
      low: v.low,
      mid: v.mid,
      high: v.high,
      open: l.open,
      target: l.target,
      ceiling: l.ceiling,
      adjustPct: v.adjustPct,
      compsUsed: v.count,
      netYieldAtTarget: i.rentPcm ? atTarget.netYield : null,
      netIncome: i.rentPcm ? atTarget.netIncome : null,
      cashAtTarget: i.useMortgage ? atTarget.cashInMortgage : atTarget.cashIn,
      daysListed: this.daysListed(),
      sellerPaid: seller?.paid ?? null,
      sellerYears: seller?.yearsHeld ?? null,
      crimeTotal: a?.crime?.total ?? null,
      floodAreas: a?.flood ? a.flood.areas.length : null,
      hpiChangePct: a?.hpi?.annualChangePct ?? null,
      stationM: a?.amenities?.station?.distanceM ?? null,
    };
    const list = this.saved();
    const at = list.findIndex((s) => s.id === snap.id);
    if (at >= 0) {
      this.saved.set(list.map((s, n) => (n === at ? snap : s)));
      this.saveNote.set('Comparison updated with the current figures.');
    } else if (list.length >= MAX_SAVED) {
      this.saveNote.set(`${MAX_SAVED} houses are already saved. Remove one on the Compare tab first.`);
    } else {
      this.saved.set([...list, snap]);
      this.saveNote.set(list.length + 1 >= 2 ? `Saved. ${list.length + 1} houses are ready to compare.` : 'Saved. Analyse another house and add it to compare the two.');
    }
  }

  openSaved(s: Snapshot): void {
    this.inputs.set({ ...DEFAULT_INPUTS, ...s.inputs });
    this.go('analyse');
    void this.analyse();
  }

  removeSaved(id: string): void {
    this.saved.update((list) => list.filter((s) => s.id !== id));
  }

  go(view: View): void {
    this.view.set(view);
    window.scrollTo({ top: 0 });
  }

  toggleTheme(): void {
    this.theme.set(this.isDark() ? 'light' : 'dark');
  }

  // ---- derived analysis: recalculates instantly when an input or a comparable changes ----
  readonly trend = computed(() => localTrend(this.nearbySales(), this.inputs().propertyType));
  readonly factors = computed(() => adjustmentFactors(this.inputs(), this.trend()));
  readonly adjustPct = computed(() => this.factors().reduce((sum, f) => sum + f.pct, 0));
  readonly value = computed(() => valuation(this.comps(), this.inputs().floorArea, this.adjustPct(), this.inputs().propertyType));
  readonly areaLoading = signal(false);
  readonly ladder = computed(() => {
    const v = this.value();
    return v ? offerLadder(v, this.inputs().asking) : null;
  });
  readonly stance = computed(() => {
    const v = this.value();
    const asking = this.inputs().asking;
    return v && asking ? askingStance(v, asking) : null;
  });
  readonly selectedCount = computed(() => this.comps().filter((c) => c.selected).length);
  readonly withAreaCount = computed(() => this.comps().filter((c) => c.selected && c.m2).length);
  readonly yieldPrice = computed(() => {
    const i = this.inputs();
    return i.rentPcm && i.rentPcm > 0 ? maxPriceForYield(i.targetNetYieldPct, i.rentPcm, i) : null;
  });
  readonly pricePoints = computed(() => {
    const l = this.ladder();
    const asking = this.inputs().asking;
    const points: { label: string; price: number }[] = [];
    if (l) points.push({ label: 'Open', price: l.open }, { label: 'Target', price: l.target }, { label: 'Maximum', price: l.ceiling });
    if (asking) points.push({ label: 'Asking', price: asking });
    return points;
  });
  readonly returns = computed(() => {
    const i = this.inputs();
    if (!i.rentPcm || i.rentPcm <= 0) return [];
    return this.pricePoints().map((p) => ({ ...p, r: rentalReturns(p.price, i.rentPcm as number, i) }));
  });
  readonly duty = computed(() =>
    this.pricePoints().map((p) => ({
      ...p,
      firstHome: sdlt(p.price, 'firstHome', this.inputs().nonResident),
      standard: sdlt(p.price, 'standard', this.inputs().nonResident),
      additional: sdlt(p.price, 'additional', this.inputs().nonResident),
    })),
  );
  readonly targetReturn = computed(() => this.returns().find((r) => r.label === 'Target') ?? null);
  readonly seller = computed(() => sellerPosition(this.history(), this.inputs().asking, this.inputs().sellerWorks));
  readonly daysListed = computed(() => daysOnMarket(this.inputs().listedDate));
  readonly sector = computed(() => {
    const g = this.geo();
    return g ? `${g.outcode} ${g.postcode.split(' ')[1]?.[0] ?? ''}`.trim() : '';
  });
  readonly links = computed(() => {
    const g = this.geo();
    if (!g) return null;
    const pc = encodeURIComponent(g.postcode);
    const out = g.outcode.toLowerCase();
    return {
      epc: `https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=${pc}`,
      housemetric: `https://housemetric.co.uk/results?str_input=${encodeURIComponent(this.sector())}`,
      rent: `https://www.zoopla.co.uk/to-rent/property/${out}/`,
      forSale: `https://www.zoopla.co.uk/for-sale/property/${out}/`,
      title: 'https://search-property-information.service.gov.uk/',
      flood: 'https://check-long-term-flood-risk.service.gov.uk/postcode',
      deprivation: g.lsoaCode ? `https://deprivation.communities.gov.uk/about-your-neighbourhood/${g.lsoaCode}` : '',
      licensing: `https://www.google.com/search?q=${encodeURIComponent(`selective licensing ${g.district} council streets`)}`,
      sdlt: 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates',
    };
  });

  // ---- actions ----
  async analyse(event?: Event): Promise<void> {
    event?.preventDefault();
    const i = this.inputs();
    if (!i.postcode.trim()) {
      this.fail('Enter the postcode of the house.');
      return;
    }
    this.status.set('loading');
    this.error.set('');
    this.saveNote.set('');
    try {
      const geo = await this.data.lookupPostcode(i.postcode);
      if (geo.country !== 'England' && geo.country !== 'Wales') {
        throw new Error(`Land Registry price data covers England and Wales only. ${geo.postcode} is in ${geo.country}.`);
      }
      const nearby = await this.data.nearbyPostcodes(geo, i.wideSearch);
      const since = new Date();
      since.setMonth(since.getMonth() - i.monthsBack);
      const [sales, own] = await Promise.all([this.data.sales(nearby, since.toISOString().slice(0, 10)), this.data.sales(new Map([[geo.postcode, 0]]), null)]);
      // Area context loads in the background so a slow source never holds up the offer.
      this.area.set(null);
      this.areaLoading.set(true);
      void this.data.area(geo).then((area) => {
        if (this.geo()?.postcode !== geo.postcode) return;
        this.area.set(area);
        this.areaLoading.set(false);
        // A house saved before its area data arrived gets those figures filled in.
        const id = this.currentId();
        this.saved.update((list) =>
          list.map((s) =>
            s.id === id
              ? {
                  ...s,
                  crimeTotal: area.crime?.total ?? null,
                  floodAreas: area.flood ? area.flood.areas.length : null,
                  hpiChangePct: area.hpi?.annualChangePct ?? null,
                  stationM: area.amenities?.station?.distanceM ?? null,
                }
              : s,
          ),
        );
      });
      this.geo.set(geo);
      this.set('postcode', geo.postcode);
      this.nearbySales.set(sales);
      this.history.set(own.filter((s) => isSubject(s, i.houseNumber, geo.postcode)));
      this.rebuildComps();
      this.pasteNote.set('');
      this.status.set('done');
      // On a phone the report sits below the form, so bring it into view.
      if (window.innerWidth < 1024) setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Something went wrong while loading the data.');
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.status.set('error');
  }

  /** Same property type, ordinary market sales, not the subject itself. Price outliers start unticked. */
  rebuildComps(): void {
    const i = this.inputs();
    const g = this.geo();
    if (!g) return;
    const pool = this.nearbySales().filter((s) => s.type === i.propertyType && s.standard && !isSubject(s, i.houseNumber, g.postcode));
    const [q1, , q3] = quartiles(pool.map((s) => s.price));
    const iqr = q3 - q1;
    const previous = new Map(this.comps().map((c) => [c.id, c]));
    this.comps.set(
      pool.map((s) => {
        const id = `${s.postcode}|${s.paon}|${s.saon}|${s.date}`;
        const outlier = pool.length >= 4 && (s.price > q3 + 1.5 * iqr || s.price < q1 - 1.5 * iqr);
        const old = previous.get(id);
        return { ...s, id, selected: old ? old.selected : !outlier, m2: old ? old.m2 : null };
      }),
    );
  }

  toggleComp(id: string): void {
    this.comps.update((list) => list.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  }

  setCompArea(id: string, event: Event): void {
    const m2 = this.num(event);
    this.comps.update((list) => list.map((c) => (c.id === id ? { ...c, m2 } : c)));
  }

  applyPaste(): void {
    const pasted = parsePastedAreas(this.pasteText());
    if (!pasted.length) {
      this.pasteNote.set('No floor areas found in that text. Each line needs a house number, a postcode and an area such as "71 m²".');
      return;
    }
    const { comps, matched } = applyPastedAreas(this.comps(), pasted);
    this.comps.set(comps);
    this.pasteNote.set(`${pasted.length} rows read, ${matched} matched to the comparables below.`);
  }

  /** Keep only comparables within 25% of the subject's floor area. Needs areas on the comparables. */
  keepSimilarSize(): void {
    const area = this.inputs().floorArea;
    if (!area) return;
    this.comps.update((list) => list.map((c) => ({ ...c, selected: !!c.m2 && Math.abs(c.m2 / area - 1) <= 0.25 })));
  }

  print(): void {
    window.print();
  }

  // ---- form helpers ----
  set<K extends keyof Inputs>(key: K, value: Inputs[K]): void {
    this.inputs.update((i) => ({ ...i, [key]: value }));
    if (key === 'propertyType') this.rebuildComps();
  }
  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  num(event: Event): number | null {
    const v = (event.target as HTMLInputElement).value.replace(/[£,\s]/g, '');
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  num0(event: Event): number {
    return this.num(event) ?? 0;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
  // Select values come back as plain strings; the option lists in the template only contain valid keys.
  pick<K extends keyof Inputs>(key: K, event: Event): void {
    this.set(key, (event.target as HTMLSelectElement).value as Inputs[K]);
  }

  // ---- formatting ----
  gbp(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return (n < 0 ? '-£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
  }
  pct(n: number | null | undefined, digits = 1): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return `${n.toFixed(digits)}%`;
  }
  round1(n: number): number {
    return Math.round(n * 10) / 10;
  }
  abs(n: number): number {
    return Math.abs(n);
  }
  signedPct(n: number): string {
    return `${n > 0 ? '+' : ''}${n}%`;
  }
  day(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  address(s: Sale): string {
    const title = (t: string) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return [s.saon, s.paon, title(s.street)].filter(Boolean).join(' ');
  }
  vsAsking(price: number): string {
    const asking = this.inputs().asking;
    if (!asking) return '';
    const diff = (price / asking - 1) * 100;
    return `${diff > 0 ? '+' : ''}${diff.toFixed(0)}% vs asking`;
  }
}
