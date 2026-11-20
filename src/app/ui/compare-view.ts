import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { compare, CriterionKey } from '../compare';
import { gbp, pct, signed } from '../format';
import { Snapshot } from '../models';
import { Icon } from './icon';

interface Row {
  label: string;
  cell: (s: Snapshot) => string;
  criterion?: CriterionKey;
  strong?: boolean;
}

const HEATING: Record<string, string> = { gas: 'Gas central', electric: 'Electric', none: 'None', unknown: 'Not given' };
const EPC: Record<string, string> = { ABC: 'A to C', D: 'D', E: 'E', FG: 'F or G', unknown: 'Not given' };
const CONDITION: Record<string, string> = { refurbished: 'Refurbished', average: 'Average', dated: 'Dated', needsWork: 'Needs work' };

@Component({
  selector: 'app-compare-view',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col gap-5' },
  template: `
    @if (saved().length < 2) {
      <div class="card overflow-hidden">
        <div class="bg-brand-soft p-5 sm:p-8">
          <span class="pill border-brand/20 bg-surface text-brand">Compare up to 3 houses</span>
          <h1 class="mt-4 max-w-xl font-display text-[24px] leading-tight font-extrabold tracking-tight text-balance sm:text-[32px]">Put two or three houses side by side and see which one to go for.</h1>
          <p class="mt-3 max-w-xl text-[15.5px] text-muted">Analyse a house, press <b class="text-ink">Add to comparison</b>, then do the same for the next one. They can be on the same street or in different towns.</p>
          <button type="button" class="btn-primary mt-5" (click)="goAnalyse.emit()"><app-icon name="search" [size]="18" />Analyse a house</button>
        </div>
        <div class="card-pad">
          @if (saved().length === 1) {
            <p class="text-[14.5px]"><b>{{ saved()[0].label }}</b> is saved. Add one more house to start comparing.</p>
          } @else {
            <p class="text-[14.5px] text-muted">Nothing saved yet. Saved houses stay in this browser only.</p>
          }
        </div>
      </div>
    } @else {
      @if (result(); as r) {
        <article class="card overflow-hidden">
          <div class="card-pad flex flex-col gap-4">
            <p class="text-[11.5px] font-bold tracking-widest text-brand uppercase">Our pick of {{ saved().length }}</p>
            <div class="flex flex-wrap items-end justify-between gap-3">
              <h1 class="font-display text-[22px] leading-tight font-extrabold tracking-tight text-balance sm:text-[28px]">{{ saved()[r.pick].label }}</h1>
              <span class="pill border-brand/30 bg-brand-soft text-[13px] text-brand">Score {{ r.totals[r.pick].toFixed(0) }} / 100</span>
            </div>
            @if (r.margin < 5 && r.runnerUp !== null) {
              <div class="callout"><app-icon name="alert" /><p><b>Close call.</b> {{ saved()[r.runnerUp].label }} is {{ r.margin < 1 ? 'level on points' : 'only ' + r.margin.toFixed(0) + ' points behind' }}. Let the survey, the viewing and the seller's flexibility decide.</p></div>
            }
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <h2 class="mb-2 font-display text-[14px] font-bold">Why this one</h2>
                <ul class="list">
                  @for (reason of r.reasons; track reason) { <li>{{ reason }}</li> }
                  @if (!r.reasons.length) { <li>It is not the single best on any one measure, but it is the most balanced across all of them.</li> }
                  <li>Offer: open at <b>{{ gbp(saved()[r.pick].open) }}</b>, aim for <b>{{ gbp(saved()[r.pick].target) }}</b>, maximum <b>{{ gbp(saved()[r.pick].ceiling) }}</b>.</li>
                </ul>
              </div>
              <div>
                <h2 class="mb-2 font-display text-[14px] font-bold">What to watch</h2>
                <ul class="list">
                  @for (c of r.cautions; track c) { <li>{{ c }}</li> }
                  @if (r.roughValuation) { <li>At least one valuation is an estimate without real floor areas for the comparables. Add floor areas in the analysis and save it again for a firmer answer.</li> }
                  @if (r.weightUsed < 100) { <li>Only {{ r.weightUsed }}% of the scoring could be used because some figures are missing (asking price, rent, floor area or listing date).</li> }
                  @if (!r.cautions.length && !r.roughValuation && r.weightUsed === 100) { <li>No measure where this house is the weakest of the group.</li> }
                </ul>
              </div>
            </div>
          </div>
          <p class="border-t border-line bg-sunken px-4 py-3 text-[12.5px] text-muted sm:px-6">Scoring: price against nearby sales 30, rental return 25, cash needed 10, space for the money 10, condition 10, crime 10, days on the market 5. Small gaps count for less than large ones, and 50 means level. The pick is arithmetic on your inputs; a survey can overturn it.</p>
        </article>

        <div class="flex flex-wrap gap-2">
          @for (row of r.results; track row.criterion.key) {
            @if (row.best !== null) {
              <span class="pill max-w-full bg-surface whitespace-normal!"><app-icon name="check" [size]="14" /><span><span class="text-ink">{{ row.criterion.bestFor }}:</span> {{ short(saved()[row.best].label) }}</span></span>
            }
          }
        </div>

        <article class="card card-pad">
          <div class="section-head"><span class="icon-badge"><app-icon name="rows" /></span><h2>Side by side</h2></div>
          <div class="scroll-x">
            <table class="tbl">
              <tr>
                <th class="sticky left-0 z-10 min-w-36"></th>
                @for (s of saved(); track s.id; let i = $index) {
                  <th class="min-w-44 align-top normal-case!">
                    <span class="block text-[13px] font-bold tracking-normal whitespace-normal text-ink">{{ s.label }}</span>
                    @if (i === r.pick) { <span class="mt-1 inline-block rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-brand-ink uppercase">Our pick</span> }
                    <span class="mt-2 flex gap-1.5 print:hidden">
                      <button type="button" class="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-semibold tracking-normal text-ink normal-case hover:border-brand" (click)="open.emit(s)">Open</button>
                      <button type="button" class="rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-semibold tracking-normal text-muted normal-case hover:border-bad hover:text-bad" (click)="remove.emit(s.id)">Remove</button>
                    </span>
                  </th>
                }
              </tr>
              <tr class="hl">
                <td class="sticky left-0 z-10 bg-brand-soft">Score</td>
                @for (s of saved(); track s.id; let i = $index) { <td>{{ r.totals[i].toFixed(0) }} / 100</td> }
              </tr>
              @for (row of rows; track row.label) {
                <tr>
                  <td class="sticky left-0 z-10 bg-surface text-muted">{{ row.label }}</td>
                  @for (s of saved(); track s.id; let i = $index) {
                    <td [class.font-semibold]="row.strong" [class]="isBest(row, i) ? 'bg-brand-soft font-semibold text-brand' : ''">{{ row.cell(s) }}</td>
                  }
                </tr>
              }
            </table>
          </div>
          <p class="hint mt-3">Green cells are the best of the group on a scored measure. Figures are frozen from when each house was added; open a house, change it and add it again to update.</p>
        </article>
      }
    }
  `,
})
export class CompareView {
  readonly saved = input.required<Snapshot[]>();
  readonly open = output<Snapshot>();
  readonly remove = output<string>();
  readonly goAnalyse = output<void>();

  protected readonly result = computed(() => compare(this.saved()));
  protected readonly gbp = gbp;

  protected readonly rows: Row[] = [
    { label: 'Asking price', cell: (s) => gbp(s.inputs.asking), strong: true },
    { label: 'Value range', cell: (s) => `${gbp(s.low)} to ${gbp(s.high)}` },
    { label: 'Middle value', cell: (s) => gbp(s.mid) },
    { label: 'Asking vs middle value', cell: (s) => (s.inputs.asking ? signed((s.inputs.asking / s.mid - 1) * 100) : 'n/a'), criterion: 'value' },
    { label: 'Open at', cell: (s) => gbp(s.open) },
    { label: 'Aim for', cell: (s) => gbp(s.target), strong: true },
    { label: 'Maximum', cell: (s) => gbp(s.ceiling), strong: true },
    { label: 'Net yield at target', cell: (s) => pct(s.netYieldAtTarget), criterion: 'yield' },
    { label: 'Net income a year', cell: (s) => gbp(s.netIncome) },
    { label: 'Cash needed at target', cell: (s) => gbp(s.cashAtTarget), criterion: 'cash' },
    { label: 'Target price per m²', cell: (s) => (s.inputs.floorArea ? gbp(s.target / s.inputs.floorArea) : 'n/a'), criterion: 'size' },
    { label: 'Floor area', cell: (s) => (s.inputs.floorArea ? `${s.inputs.floorArea} m²` : 'n/a') },
    { label: 'Bedrooms', cell: (s) => (s.inputs.bedrooms ? `${s.inputs.bedrooms}` : 'n/a') },
    { label: 'Heating', cell: (s) => HEATING[s.inputs.heating] },
    { label: 'EPC', cell: (s) => EPC[s.inputs.epc] },
    { label: 'Condition', cell: (s) => `${CONDITION[s.inputs.condition]} (${signed(s.adjustPct)})`, criterion: 'condition' },
    { label: 'Days on the market', cell: (s) => (s.daysListed !== null ? `${s.daysListed}` : 'n/a'), criterion: 'leverage' },
    { label: 'Seller paid', cell: (s) => (s.sellerPaid !== null ? `${gbp(s.sellerPaid)}, ${s.sellerYears?.toFixed(1)} yrs ago` : 'No record') },
    { label: 'Crimes within a mile', cell: (s) => (s.crimeTotal !== null ? `${s.crimeTotal}` : 'n/a'), criterion: 'crime' },
    { label: 'Flood areas within 1 km', cell: (s) => (s.floodAreas !== null ? `${s.floodAreas}` : 'n/a') },
    { label: 'Nearest station', cell: (s) => (s.stationM !== null ? `${(s.stationM / 1000).toFixed(1)} km` : 'n/a') },
    { label: 'Council-area prices, 1 yr', cell: (s) => signed(s.hpiChangePct, 1) },
    { label: 'Area', cell: (s) => s.district },
    { label: 'Valuation basis', cell: (s) => `${s.basis === 'perM2' ? 'Per m²' : s.basis === 'sizeAdjusted' ? 'Size-adjusted estimate' : 'Price only'}, ${s.compsUsed} sales` },
  ];

  protected isBest(row: Row, index: number): boolean {
    if (!row.criterion) return false;
    return this.result()?.results.find((x) => x.criterion.key === row.criterion)?.best === index;
  }
  protected short(label: string): string {
    return label.length > 26 ? label.slice(0, 25) + '…' : label;
  }
}
