import { Component, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { DataService } from './data.service';
import { demandOutlook } from './demand';
import {
  adjustmentFactors,
  assumedFloorArea,
  askingStance,
  daysOnMarket,
  evidenceGapPct,
  isSubject,
  normaliseHouse,
  localTrend,
  maxPriceForYield,
  offerLadder,
  ownSale,
  quartiles,
  rentalReturns,
  sdlt,
  sellerPosition,
  TAX,
  valuation,
} from './engine';
import { matchHouse, parseListing, pastedLink, streetPostcodes } from './listing-import';
import { AreaData, Comp, DEFAULT_INPUTS, DemandData, Geo, Inputs, Journeys, Places, PlacesMeta, PropertyType, Sale, School, SdltMode, Snapshot } from './models';
import { HouseFacts, summaryPoints } from './next-steps';
import { applyPastedAreas, parsePastedAreas } from './paste';
import { bookmarklet, ListingPhoto, readSentListing, SentListing } from './send-button';
import { metres } from './places';
import { CalculatorsView } from './ui/calculators-view';
import { CompareView } from './ui/compare-view';
import { GlossaryView } from './ui/glossary-view';
import { NextStepsView } from './ui/next-steps-view';
import { Icon } from './ui/icon';
import { ValueBar } from './ui/value-bar';

const STORE_KEY = 'property-offer-analyser.inputs.v1';
const THEME_KEY = 'property-offer-analyser.theme';
const SAVED_KEY = 'property-offer-analyser.saved.v1';
const MAX_SAVED = 3;
type View = 'analyse' | 'compare' | 'calculators' | 'glossary';

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
  imports: [Icon, ValueBar, CompareView, CalculatorsView, GlossaryView, NextStepsView],
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
  readonly demand = signal<DemandData | null>(null);
  /** What is around the house. The map server can take up to a minute, so this arrives after the rest of the report. */
  readonly places = signal<Places | null>(null);
  readonly placesState = signal<'idle' | 'loading' | 'done' | 'failed'>('idle');
  /** Car parks, GPs and shops still come from the public map server, which is slow, so they follow the official places. */
  readonly extrasState = signal<'idle' | 'loading' | 'done' | 'failed'>('idle');
  readonly placesMeta = signal<PlacesMeta | null>(null);
  readonly journeys = signal<Journeys | null>(null);
  readonly metres = metres;
  readonly demandLoading = signal(false);
  readonly listingText = signal('');
  readonly importBusy = signal(false);
  readonly importFound = signal<string[]>([]);
  readonly importNote = signal('');
  readonly importPostcodes = signal<{ postcode: string; sales: number }[]>([]);
  /** Set when a web address was pasted instead of the listing text, so the page can offer to open it. */
  readonly importLink = signal('');
  /** Photos and floor plans that came with a listing sent by the browser button. Shown from the property site; never stored. */
  readonly photos = signal<ListingPhoto[]>([]);
  readonly sentFrom = signal<{ url: string; site: string } | null>(null);
  readonly galleryPhotos = computed(() => this.photos().filter((p) => !p.floorPlan));
  readonly floorPlans = computed(() => this.photos().filter((p) => p.floorPlan));
  /** The "Send to OfferLadder" bookmark. It is this app's own script, written in send-button.ts, so it is safe to offer as a link. */
  readonly sendButton = inject(DomSanitizer).bypassSecurityTrustUrl(bookmarklet(new URL('.', document.baseURI).href));
  readonly sendButtonNote = signal('');
  /** The postcode district the photos belong to, so they are dropped when a house somewhere else is analysed. */
  private photosOutcode = '';
  /** Local prices today over local prices in the month this house last sold; null when not known. */
  readonly ownIndex = signal<number | null>(null);
  /** Says so when the property type was taken from the house's own Land Registry record. */
  readonly typeNote = signal('');
  private analysedId = '';
  readonly pasteText = signal('');
  readonly pasteNote = signal('');
  readonly taxCheckedOn = TAX.checkedOn;
  readonly view = signal<View>('analyse');
  readonly saved = signal<Snapshot[]>(loadSaved());
  readonly saveNote = signal('');
  readonly views: { key: View; label: string }[] = [
    { key: 'analyse', label: 'Analyse' },
    { key: 'compare', label: 'Compare' },
    { key: 'calculators', label: 'Calculators' },
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
    { id: 'next', label: 'Next steps' },
    { id: 'house', label: 'This house' },
    { id: 'comps', label: 'Comparables' },
    { id: 'value', label: 'Value' },
    { id: 'returns', label: 'Returns' },
    { id: 'duty', label: 'Stamp duty' },
    { id: 'location', label: 'Location' },
    { id: 'area', label: 'Area' },
    { id: 'demand', label: 'Demand' },
    { id: 'checks', label: 'Checks' },
  ];

  readonly sdltModes: { key: SdltMode; label: string }[] = [
    { key: 'firstHome', label: 'First home to live in' },
    { key: 'standard', label: 'Only property you will own' },
    { key: 'additional', label: 'Additional property or company' },
  ];

  constructor() {
    // A listing sent by the browser button arrives in the page address. Take it out of the address once read,
    // so reloading or sharing the page does not import it again.
    const sent = readSentListing(location.hash);
    if (sent) {
      history.replaceState(null, '', location.pathname + location.search);
      this.listingText.set(sent.text);
      void this.importListing(sent);
    }
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
  /** What the calculators start from: the house on screen, if one has been analysed. */
  readonly calculatorPrice = computed(() => (this.status() === 'done' ? (this.ladder()?.target ?? this.inputs().asking) : this.inputs().asking));
  readonly calculatorLabel = computed(() => {
    const g = this.geo();
    if (this.status() !== 'done' || !g || !this.calculatorPrice()) return '';
    const name = [this.inputs().houseNumber, this.inputs().street].filter(Boolean).join(' ');
    return `${this.ladder() ? 'the "aim for" price' : 'the asking price'} of ${name ? `${name}, ` : ''}${g.postcode}`;
  });
  /** The house as you would write it to an estate agent. */
  readonly fullAddress = computed(() => {
    const g = this.geo();
    const street = [this.inputs().houseNumber, this.inputs().street].filter(Boolean).join(' ');
    return [street, g?.postcode ?? this.inputs().postcode].filter(Boolean).join(', ') || 'the property';
  });
  readonly houseFacts = computed<HouseFacts>(() => ({
    inputs: this.inputs(),
    floodAreas: this.area()?.flood ? this.area()!.flood!.areas.length : null,
    sellerYears: this.seller()?.yearsHeld ?? null,
    daysListed: this.daysListed(),
  }));
  /** The whole report in a few plain lines. */
  readonly summary = computed(() => {
    const p = this.places();
    const seller = this.seller();
    const crime = this.area()?.crime;
    const flood = this.area()?.flood;
    const rated = p?.official ? p.schools.filter((s) => s.ofsted) : null;
    return summaryPoints({
      stance: this.stance(),
      asking: this.inputs().asking,
      sellerPaid: seller?.paid ?? null,
      sellerPaidDate: seller?.paidDate ?? null,
      sellerYears: seller?.yearsHeld ?? null,
      daysListed: this.daysListed(),
      netYieldAtTarget: this.targetReturn()?.r.netYield ?? null,
      targetYield: this.inputs().targetNetYieldPct,
      stationName: p?.stations[0]?.kind === 'Rail' ? p.stations[0].name : null,
      stationWalkMinutes: this.journeys()?.stationWalk?.minutes ?? null,
      schools: p?.official ? p.schoolCount : null,
      schoolsGood: rated ? rated.filter((s) => !s.ofsted!.weak).length : null,
      demand: this.outlook()?.verdict ?? null,
      district: this.geo()?.district ?? '',
      floodAreas: flood ? flood.areas.length : null,
      crimeNow: crime?.total ?? null,
      crimeYearAgo: crime?.yearAgo ?? null,
      epc: this.inputs().epc,
      parking: this.inputs().parking,
    });
  });
  /** The optional part of the form starts open only if something in it has already been filled in. */
  readonly moreOpen = (() => {
    const i = this.inputs();
    return i.condition !== 'average' || i.heating !== 'unknown' || i.epc !== 'unknown' || !!i.rentPcm || i.useMortgage || i.sdltMode !== DEFAULT_INPUTS.sdltMode || i.bathroomDownstairs || i.boxRoom;
  })();
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
      stationM: this.places()?.stations[0]?.distanceM ?? null,
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
    // A saved house keeps the type it was saved with.
    void this.analyse(undefined, true);
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
  /** The floor area used for the valuation: the one entered, or one assumed from the bedroom count. */
  readonly areaAssumed = computed(() => !this.inputs().floorArea && assumedFloorArea(this.inputs().propertyType, this.inputs().bedrooms) !== null);
  readonly areaUsed = computed(() => this.inputs().floorArea || assumedFloorArea(this.inputs().propertyType, this.inputs().bedrooms));
  /** The house's own last sale at today's prices, when it is recent enough to count. */
  readonly own = computed(() => ownSale(this.history(), this.ownIndex()));
  readonly value = computed(() => valuation(this.comps(), this.areaUsed(), this.adjustPct(), this.inputs().propertyType, this.own()));
  /** Set when nearby sales alone sit more than 15% away from the house's own sale: a sign they are not like for like. */
  readonly evidenceGap = computed(() => {
    const v = this.value();
    const gap = v ? evidenceGapPct(v) : null;
    return gap !== null && Math.abs(gap) > 15 ? gap : null;
  });
  readonly areaLoading = signal(false);
  /** Where the council area's housing market is heading, from prices, sales, population, supply, earnings and jobs. */
  readonly outlook = computed(() => {
    const d = this.demand();
    return d ? demandOutlook(d, this.inputs().propertyType) : null;
  });
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
      localHousing: /^[EW]\d{8}$/.test(g.districtCode) ? `https://www.ons.gov.uk/visualisations/housingpriceslocal/${g.districtCode}/` : '',
      deprivation: g.lsoaCode ? `https://deprivation.communities.gov.uk/about-your-neighbourhood/${g.lsoaCode}` : '',
      licensing: `https://www.google.com/search?q=${encodeURIComponent(`selective licensing ${g.district} council streets`)}`,
      sdlt: 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates',
    };
  });

  // ---- import from a pasted listing ----
  /** Read pasted listing text, fill the form, then identify the exact house from Land Registry and analyse it. */
  async importListing(sent?: SentListing): Promise<void> {
    this.importLink.set('');
    this.sendButtonNote.set('');
    this.photos.set(sent?.photos ?? []);
    this.sentFrom.set(sent?.url ? { url: sent.url, site: sent.site ?? 'the listing' } : null);
    const link = pastedLink(this.listingText());
    if (link) {
      // Nothing can be read from a web address alone, so say so plainly instead of failing quietly.
      this.importFound.set([]);
      this.importPostcodes.set([]);
      this.importLink.set(link.url);
      this.importNote.set(
        `That is a link to the listing, not the listing itself, so there is no price or address in it to read. ${link.portal ?? 'The property site'} does not let other websites open its pages, and OfferLadder runs entirely in your browser. ` +
          'Open the listing, select the whole page (Ctrl+A, or Cmd+A on a Mac), copy it, and paste it here in place of the link.',
      );
      return;
    }
    const p = parseListing(this.listingText());
    // The page's own data often holds the full postcode that the visible address leaves out.
    if (sent?.postcode && !p.postcode) {
      p.postcode = sent.postcode;
      p.outcode = sent.postcode.split(' ')[0];
    }
    this.photosOutcode = p.outcode ?? '';
    const found: string[] = [];
    if (p.asking) found.push(`Asking ${this.gbp(p.asking)}`);
    if (p.bedrooms) found.push(`${p.bedrooms} bed`);
    if (p.propertyType) found.push(this.propertyTypes.find((t) => t.key === p.propertyType)?.label ?? p.propertyType);
    if (p.street) found.push([p.houseNumber, p.street, p.postcode ?? p.outcode].filter(Boolean).join(' '));
    if (p.listedDate) found.push(`Listed ${this.day(p.listedDate)}`);
    if (p.floorArea) found.push(`${p.floorArea} m²`);
    if (p.epc) found.push(`EPC ${p.epc === 'ABC' ? 'A to C' : p.epc === 'FG' ? 'F or G' : p.epc}`);
    if (p.heating) found.push(p.heating === 'gas' ? 'Gas heating' : 'Electric heating');
    if (p.condition === 'refurbished') found.push('Refurbished');
    if (p.chainFree) found.push('No chain');
    if (p.parking) found.push(p.parking === 'offStreet' ? 'Off-street parking' : 'On-street parking only');
    if (p.pastSales.length) found.push(`${p.pastSales.length} past sale${p.pastSales.length === 1 ? '' : 's'}`);
    if (sent) {
      const plans = sent.photos.filter((x) => x.floorPlan).length;
      if (sent.photos.length - plans) found.push(`${sent.photos.length - plans} photos`);
      if (plans) found.push(plans === 1 ? 'Floor plan' : `${plans} floor plans`);
    }
    this.importFound.set(found);
    this.importPostcodes.set([]);
    if (!p.asking && !p.street) {
      this.importNote.set('Could not read a price or an address from that text. Open the listing page itself (not the search results), select all, copy and paste again.');
      return;
    }

    // A new listing is a new house: clear the identity fields, keep the buyer's own cost settings.
    this.inputs.update((i) => ({
      ...i,
      houseNumber: p.houseNumber ?? '',
      street: p.street ?? '',
      postcode: p.postcode ?? '',
      asking: p.asking ?? null,
      bedrooms: p.bedrooms ?? null,
      floorArea: p.floorArea ?? null,
      listedDate: p.listedDate ?? '',
      propertyType: p.propertyType ?? i.propertyType,
      epc: p.epc ?? 'unknown',
      heating: p.heating ?? 'unknown',
      condition: p.condition ?? 'average',
      bathroomDownstairs: p.bathroomDownstairs,
      parking: p.parking ?? 'unknown',
      boxRoom: false,
      rentPcm: null,
    }));
    // A browser's Share button sends the headline and a link, not the page: say what that leaves out.
    const headlineOnly = this.listingText().trim().length < 400 && !p.listedDate && !p.pastSales.length;
    const headlineHint = headlineOnly ? ' Only the listing\'s headline was pasted, so the date listed, floor area, EPC and past sales are not known. Paste the whole page to add them.' : '';
    const rentHint = headlineHint + (p.agentRent ? ` The agent mentions ${this.gbp(p.agentRent)} a month in rent; check that against live rents before using it.` : '');

    if (p.postcode && p.houseNumber) {
      this.importNote.set(`Full address found in the listing.${rentHint}`);
      await this.analyse();
      return;
    }
    if (!p.street || (!p.outcode && !p.places.length)) {
      this.importNote.set(`The listing does not show enough of the address to find the house. Enter the postcode and press Analyse.${rentHint}`);
      return;
    }

    this.importBusy.set(true);
    this.importNote.set('Looking for this house in Land Registry…');
    try {
      const sales = await this.data.streetSales(p.street, p.outcode, [...p.places].reverse());
      const match = matchHouse(p.pastSales, sales);
      if (match) {
        this.set('houseNumber', match.houseNumber);
        this.set('postcode', match.postcode);
        const when = match.sale.month ? `${new Date(2000, match.sale.month - 1).toLocaleString('en-GB', { month: 'long' })} ${match.sale.year}` : `${match.sale.year}`;
        this.importNote.set(`Identified as ${match.houseNumber} ${p.street}, ${match.postcode}: Land Registry has one sale on this street at ${this.gbp(match.sale.price)} in ${when}.${rentHint}`);
        await this.analyse();
      } else {
        const options = streetPostcodes(sales);
        this.importPostcodes.set(options.slice(0, 6));
        if (p.postcode ?? options[0]?.postcode) {
          this.set('postcode', p.postcode ?? options[0].postcode);
          this.importNote.set(
            `${p.pastSales.length ? 'The past sales did not point to one single house' : 'The listing shows no past sale to match'}, so the house number is not known. ` +
              `Using ${this.inputs().postcode}${options.length > 1 ? '; pick another part of the street below if that is wrong' : ''}. Add the house number when you have it.${rentHint}`,
          );
          await this.analyse();
        } else {
          this.importNote.set(`No Land Registry sales found for ${p.street}. Enter the postcode and press Analyse.${rentHint}`);
        }
      }
    } catch {
      this.importNote.set(`Land Registry did not respond, so the house could not be identified. Enter the postcode and press Analyse.${rentHint}`);
    } finally {
      this.importBusy.set(false);
    }
  }

  /** The bookmark is for dragging to the bookmarks bar. Clicked here it would only read this page, so explain instead. */
  sendButtonClicked(event: Event): void {
    event.preventDefault();
    this.sendButtonNote.set('Do not click it here. Drag it up to your bookmarks bar, then click it while you are looking at a listing.');
  }

  usePostcode(postcode: string): void {
    this.set('postcode', postcode);
    void this.analyse();
  }

  // ---- actions ----
  async analyse(event?: Event, keepType = false): Promise<void> {
    event?.preventDefault();
    let i = this.inputs();
    if (!i.postcode.trim()) {
      this.fail('Enter the postcode of the house.');
      return;
    }
    this.status.set('loading');
    this.error.set('');
    this.saveNote.set('');
    try {
      const geo = await this.data.lookupPostcode(i.postcode);
      if (this.photos().length && this.photosOutcode && geo.outcode !== this.photosOutcode) {
        this.photos.set([]);
        this.sentFrom.set(null);
      }
      if (geo.country !== 'England' && geo.country !== 'Wales') {
        throw new Error(`Land Registry price data covers England and Wales only. ${geo.postcode} is in ${geo.country}.`);
      }
      // From here on this is the house on the page. It is set before anything is looked up in the background,
      // so an answer that comes back at once is not mistaken for one about the previous house and thrown away.
      // (The report stays hidden while loading, so nothing half-updated is shown.)
      this.geo.set(geo);
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
                }
              : s,
          ),
        );
      });
      const history = own.filter((s) => isSubject(s, i.houseNumber, geo.postcode));
      // Land Registry records what kind of house this is. Comparing it with another kind gives a wrong value,
      // so the first analysis of a house takes the type from its own record. The buyer can still change it afterwards.
      const id = `${geo.postcode}|${normaliseHouse(i.houseNumber)}`;
      const recorded = [...history].sort((a, b) => b.date.localeCompare(a.date))[0]?.type;
      this.typeNote.set('');
      if (!keepType && id !== this.analysedId && recorded && recorded !== 'other' && recorded !== i.propertyType) {
        const label = (t: PropertyType) => this.propertyTypes.find((x) => x.key === t)?.label ?? t;
        this.typeNote.set(`Type changed from ${label(i.propertyType)} to ${label(recorded)}: that is how Land Registry records this house. Change it back if that is wrong.`);
        this.inputs.update((x) => ({ ...x, propertyType: recorded }));
        i = this.inputs();
      }
      this.analysedId = id;
      // Bring the house's own last sale to today's prices. Without the index the sale is used as it stands.
      const lastSale = ownSale(history, null);
      const move = lastSale ? await this.data.priceMove(geo, i.propertyType, lastSale.date.slice(0, 7)).catch(() => null) : null;
      void this.loadPlaces(geo);
      // The demand outlook also loads in the background. It belongs to the council area, so it is kept between houses there.
      if (this.demand()?.areaName !== geo.district) this.demand.set(null);
      this.demandLoading.set(true);
      void this.data.demand(geo).then((demand) => {
        if (this.geo()?.districtCode !== geo.districtCode) return;
        this.demand.set(demand);
        this.demandLoading.set(false);
      });
      this.set('postcode', geo.postcode);
      this.nearbySales.set(sales);
      this.ownIndex.set(move);
      this.history.set(history);
      this.rebuildComps();
      this.pasteNote.set('');
      this.status.set('done');
      // On a phone the report sits below the form, so bring it into view.
      if (window.innerWidth < 1024) setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Something went wrong while loading the data.');
    }
  }

  /**
   * What is around the house. Schools, stations and hospitals come at once from the official data that ships with the app;
   * the journeys follow; car parks, GPs and shops arrive last from the public map server.
   */
  private async loadPlaces(geo: Geo): Promise<void> {
    const current = () => this.geo()?.postcode === geo.postcode; // false once another house has been analysed
    this.places.set(null);
    this.journeys.set(null);
    this.placesState.set('loading');
    this.extrasState.set('loading');
    if (!this.placesMeta()) void this.data.placesMeta().then((m) => this.placesMeta.set(m));

    const official = await this.data.officialPlaces(geo);
    if (!current()) return;
    if (official) {
      this.showPlaces(geo, official);
      const extras = await this.data.nearbyExtras(geo).catch(() => null);
      if (!current()) return;
      if (extras) {
        const { carParks, doctors, pharmacy, supermarket, supermarketCount, park, busStops } = extras;
        this.places.update((p) => (p ? { ...p, nearOk: true, carParks, doctors, pharmacy, supermarket, supermarketCount, park, busStops } : p));
      }
      this.extrasState.set(extras ? 'done' : 'failed');
      return;
    }
    // The bundled files could not be read: fall back to the map for everything.
    const mapped = await this.data.places(geo).catch(() => null);
    if (!current()) return;
    this.extrasState.set(mapped?.nearOk ? 'done' : 'failed');
    if (mapped) this.showPlaces(geo, mapped);
    else this.placesState.set('failed');
  }

  private showPlaces(geo: Geo, places: Places): void {
    this.places.set(places);
    this.placesState.set('done');
    // A house saved before this arrived gets its station distance filled in.
    const id = this.currentId();
    this.saved.update((list) => list.map((s) => (s.id === id ? { ...s, stationM: places.stations[0]?.distanceM ?? null } : s)));
    void this.data
      .journeys(geo, places)
      .catch(() => null)
      .then((journeys) => {
        if (this.geo()?.postcode === geo.postcode) this.journeys.set(journeys);
      });
  }

  retryPlaces(): void {
    const g = this.geo();
    if (g) void this.loadPlaces(g);
  }

  schoolRecord(s: School): string {
    return `https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${s.urn}`;
  }
  schoolOfsted(s: School): string {
    return `https://reports.ofsted.gov.uk/search?q=${s.urn}`;
  }
  schoolLine(s: School): string {
    const pupils = s.pupils ? `${s.pupils.toLocaleString('en-GB')} pupils` : '';
    return [s.phase, s.kind || (s.independent ? 'independent (fee-paying)' : ''), s.gender, s.selective ? 'selective' : '', s.faith, s.ages, pupils].filter(Boolean).join(', ');
  }
  crimeChange(now: number, before: number): string {
    const pct = before > 0 ? (now / before - 1) * 100 : 0;
    return Math.abs(pct) < 3 ? 'about the same as' : `${Math.abs(pct).toFixed(0)}% ${pct > 0 ? 'more' : 'fewer'} than`;
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
    const area = this.areaUsed();
    if (!area) return;
    this.comps.update((list) => list.map((c) => ({ ...c, selected: !!c.m2 && Math.abs(c.m2 / area - 1) <= 0.25 })));
  }

  print(): void {
    window.print();
  }

  // ---- form helpers ----
  set<K extends keyof Inputs>(key: K, value: Inputs[K]): void {
    this.inputs.update((i) => ({ ...i, [key]: value }));
    if (key === 'propertyType') {
      this.typeNote.set('');
      this.rebuildComps();
    }
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
