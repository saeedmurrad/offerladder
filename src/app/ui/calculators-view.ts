import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { mortgage, sdlt, sdltBreakdown, TAX } from '../engine';
import { gbp } from '../format';
import { SdltMode } from '../models';
import { Icon } from './icon';

const DEFAULT_PRICE = 250_000;

/** Two stand-alone calculators: a mortgage repayment and stamp duty. They start from the house being analysed and can be changed freely. */
@Component({
  selector: 'app-calculators-view',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col gap-5' },
  template: `
    <div class="card card-pad">
      <p class="text-[11.5px] font-bold tracking-widest text-brand uppercase">Calculators</p>
      <h1 class="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[28px]">Mortgage and stamp duty</h1>
      <p class="mt-2 max-w-2xl text-[14.5px] text-muted">
        @if (houseLabel()) { Filled in from {{ houseLabel() }}. Change any figure to try other prices. } @else { Enter a price to see the monthly payment and the tax. Analyse a house first and these fill themselves in. }
      </p>
    </div>

    <section class="card card-pad flex flex-col gap-5" aria-labelledby="mortgage-title">
      <div class="section-head"><span class="icon-badge"><app-icon name="key" /></span><h2 id="mortgage-title">Mortgage repayment calculator</h2></div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="field"><span>Price</span>
          <div class="affix"><i>£</i><input id="mortgagePrice" class="input" type="text" inputmode="numeric" [value]="price()" (input)="price.set(num($event))"></div>
        </label>
        <div class="flex gap-3">
          <label class="field"><span>Deposit</span>
            <div class="affix"><i>£</i><input id="mortgageDeposit" class="input" type="text" inputmode="numeric" [value]="deposit()" (change)="setDeposit($event)"></div>
          </label>
          <label class="field w-24 shrink-0"><span>Deposit %</span>
            <div class="affix end"><i>%</i><input id="mortgageDepositPct" class="input" type="text" inputmode="decimal" [value]="round1(depositPct())" (input)="depositPct.set(clamp(num($event), 0, 100))"></div>
          </label>
        </div>
        <label class="field"><span>Loan term</span>
          <select id="mortgageTerm" class="input" [value]="years()" (change)="years.set(num($event))">
            @for (y of terms; track y) { <option [value]="y" [selected]="y === years()">{{ y }} years</option> }
          </select>
        </label>
        <label class="field"><span>Interest rate</span>
          <div class="affix end"><i>%</i><input id="mortgageRate" class="input" type="text" inputmode="decimal" [value]="rate()" (input)="rate.set(num($event))"></div>
        </label>
      </div>

      @if (result(); as m) {
        <div class="rounded-xl border border-brand bg-brand-soft p-4 text-center" role="status">
          <p class="text-[12px] font-bold tracking-wider text-brand uppercase">Monthly repayment</p>
          <p class="mt-1 font-display text-[34px] leading-none font-extrabold tracking-tight tabular-nums">{{ gbp(m.monthly) }} <span class="text-[15px] font-semibold text-muted">per month</span></p>
        </div>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="stat"><span>Loan</span><b>{{ gbp(m.loan) }}</b></div>
          <div class="stat"><span>Interest only</span><b>{{ gbp(m.interestOnlyMonthly) }} <small class="text-[12px] font-semibold text-muted">a month</small></b></div>
          <div class="stat"><span>Total repaid</span><b>{{ gbp(m.totalRepaid) }}</b></div>
          <div class="stat"><span>Of which interest</span><b>{{ gbp(m.totalInterest) }}</b></div>
        </div>
      } @else {
        <div class="callout"><app-icon name="alert" /><p>Enter a price, a deposit smaller than the price, a term and a rate to see the payment.</p></div>
      }
      <p class="hint">A guide only. It assumes one interest rate for the whole term, which no real mortgage has, and leaves out lender fees. What you can borrow and the rate you get depend on your own finances and a full application. With interest only, the loan is still owed in full at the end. Your home may be repossessed if you do not keep up repayments on your mortgage. This is not financial advice.</p>
    </section>

    <section class="card card-pad flex flex-col gap-5" aria-labelledby="duty-title">
      <div class="section-head"><span class="icon-badge"><app-icon name="receipt" /></span><h2 id="duty-title">Stamp duty calculator</h2></div>
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label class="field"><span>Price</span>
          <div class="affix"><i>£</i><input id="dutyPrice" class="input" type="text" inputmode="numeric" [value]="dutyPrice()" (input)="dutyPrice.set(num($event))"></div>
        </label>
        <label class="field"><span>Your situation</span>
          <select id="dutyMode" class="input" [value]="mode()" (change)="mode.set($any($event.target).value)">
            @for (m of modes; track m.key) { <option [value]="m.key" [selected]="m.key === mode()">{{ m.label }}</option> }
          </select>
        </label>
      </div>
      <label class="toggle"><span>Not resident in the UK (2% more)</span><input id="dutyNonResident" type="checkbox" [checked]="abroad()" (change)="abroad.set($any($event.target).checked)"></label>

      @if (dutyPrice() > 0) {
        <div class="rounded-xl border border-brand bg-brand-soft p-4 text-center" role="status">
          <p class="text-[12px] font-bold tracking-wider text-brand uppercase">Stamp duty to pay</p>
          <p class="mt-1 font-display text-[34px] leading-none font-extrabold tracking-tight tabular-nums">{{ gbp(duty()) }}</p>
          <p class="mt-1.5 text-[13px] text-muted">{{ effective() }}% of the price</p>
        </div>
        <div class="scroll-x"><table class="tbl">
          <tr><th>Part of the price</th><th class="n">Rate</th><th class="n">Amount in this band</th><th class="n">Tax</th></tr>
          @for (b of bands(); track b.from) {
            <tr><td>{{ b.from ? 'Over ' + gbp(b.from) : 'Up to ' + gbp(b.to) }}{{ b.from && b.to !== infinity ? ' to ' + gbp(b.to) : '' }}</td><td class="n">{{ b.ratePct }}%</td><td class="n">{{ gbp(b.slice) }}</td><td class="n">{{ gbp(b.tax) }}</td></tr>
          }
          <tr class="hl"><td>Total</td><td class="n"></td><td class="n">{{ gbp(dutyPrice()) }}</td><td class="n">{{ gbp(duty()) }}</td></tr>
        </table></div>
        @if (mode() === 'firstHome' && dutyPrice() > firstHomeCap) {
          <div class="callout"><app-icon name="alert" /><p><b>No first-home relief at this price.</b> The relief stops at {{ gbp(firstHomeCap) }}; above that the standard rates apply to the whole price.</p></div>
        }
      } @else {
        <div class="callout"><app-icon name="alert" /><p>Enter a price to see the tax.</p></div>
      }
      <p class="hint">Residential rates for England and Northern Ireland as checked on <a href="https://www.gov.uk/stamp-duty-land-tax/residential-property-rates" target="_blank" rel="noopener">gov.uk</a> on {{ checkedOn() }}. First home: you will live in it and have never owned a home anywhere. Additional: second homes, buy-to-let when you already own, and companies. Wales charges Land Transaction Tax and Scotland its own tax; neither is calculated here. A guide only: your solicitor works out the figure you actually pay.</p>
    </section>
  `,
})
export class CalculatorsView {
  /** The price to start from: the target offer on the house being analysed, or its asking price. */
  readonly startPrice = input<number | null>(null);
  readonly startMode = input<SdltMode>('standard');
  readonly startRate = input(5.2);
  readonly startDepositPct = input(10);
  readonly startNonResident = input(false);
  readonly houseLabel = input('');
  readonly checkedOn = input(TAX.checkedOn);

  protected readonly gbp = gbp;
  protected readonly infinity = Infinity;
  protected readonly firstHomeCap = TAX.firstHomeCap;
  protected readonly terms = [5, 10, 15, 20, 25, 30, 35, 40];
  protected readonly modes: { key: SdltMode; label: string }[] = [
    { key: 'firstHome', label: 'First home, to live in' },
    { key: 'standard', label: 'Moving home, or the only property you will own' },
    { key: 'additional', label: 'Additional property, buy-to-let or company' },
  ];

  // Each figure starts from the house being analysed and follows it to the next house, but can be overtyped in between.
  protected readonly price = linkedSignal(() => this.startPrice() ?? DEFAULT_PRICE);
  protected readonly depositPct = linkedSignal(() => this.startDepositPct());
  protected readonly years = linkedSignal(() => 25);
  protected readonly rate = linkedSignal(() => this.startRate());
  protected readonly dutyPrice = linkedSignal(() => this.startPrice() ?? DEFAULT_PRICE);
  protected readonly mode = linkedSignal(() => this.startMode());
  protected readonly abroad = linkedSignal(() => this.startNonResident());

  protected readonly deposit = computed(() => Math.round((this.price() * this.depositPct()) / 100));
  protected readonly result = computed(() => mortgage(this.price(), this.deposit(), this.rate(), this.years()));
  protected readonly duty = computed(() => sdlt(this.dutyPrice(), this.mode(), this.abroad()));
  protected readonly bands = computed(() => sdltBreakdown(this.dutyPrice(), this.mode(), this.abroad()));
  protected readonly effective = computed(() => (this.dutyPrice() > 0 ? ((this.duty() / this.dutyPrice()) * 100).toFixed(1) : '0'));

  /** A typed deposit in pounds is kept as a share of the price, so it follows the price when that changes. */
  protected setDeposit(event: Event): void {
    const price = this.price();
    if (price > 0) this.depositPct.set(this.clamp((this.num(event) / price) * 100, 0, 100));
  }
  protected num(event: Event): number {
    const n = Number((event.target as HTMLInputElement).value.replace(/[£,%\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  protected clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
  }
  protected round1(n: number): number {
    return Math.round(n * 10) / 10;
  }
}
