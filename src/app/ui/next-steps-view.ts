import { ChangeDetectionStrategy, Component, computed, effect, input, linkedSignal, signal } from '@angular/core';
import { Ladder } from '../engine';
import { gbp } from '../format';
import { emailLink, HouseFacts, offerMessage, offerReasons, slotLabel, viewingCalendarFile, viewingChecklist, viewingMessage, whatsAppLink } from '../next-steps';
import { Icon } from './icon';

const VIEWINGS_KEY = 'property-offer-analyser.viewings.v1';
const BUYER_KEY = 'property-offer-analyser.buyer.v1';

interface SavedViewing {
  slots: [string, string];
  checked: string[];
  notes: string;
}
const EMPTY: SavedViewing = { slots: ['', ''], checked: [], notes: '' };

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: lasts for this visit only */
  }
}

/** The two things a buyer does next: ask for a viewing, then put the offer in writing. Each is a message ready to send. */
@Component({
  selector: 'app-next-steps-view',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <article id="next" class="card card-pad">
      <div class="section-head"><span class="icon-badge"><app-icon name="arrow" /></span><h2>What to do next</h2></div>
      <div class="flex flex-col gap-7">
        <!-- 1. viewing -->
        <section class="flex flex-col gap-3" aria-labelledby="viewing-title">
          <h3 id="viewing-title" class="font-display text-[16px] font-bold"><span class="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand text-[13px] text-brand-ink">1</span>Book a viewing</h3>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="field"><span>When can you go?</span>
              <input id="viewingSlot1" class="input" type="datetime-local" [value]="viewing().slots[0]" (input)="setSlot(0, $event)">
            </label>
            <label class="field"><span>Second choice (optional)</span>
              <input id="viewingSlot2" class="input" type="datetime-local" [value]="viewing().slots[1]" (input)="setSlot(1, $event)">
            </label>
            <label class="field"><span>Your name (optional)</span>
              <input id="buyerName" class="input" type="text" autocomplete="name" [value]="name()" (input)="name.set($any($event.target).value)">
            </label>
          </div>
          <label class="field"><span>Message to the estate agent (you can change it)</span>
            <textarea id="viewingMessage" class="input h-auto! py-2.5 leading-relaxed" rows="7" [value]="viewingText()" (input)="viewingText.set($any($event.target).value)"></textarea>
          </label>
          <div class="flex flex-wrap gap-2 print:hidden">
            <button type="button" class="btn-ghost" (click)="copy('viewing', viewingText())"><app-icon name="check" [size]="16" />{{ copied() === 'viewing' ? 'Copied' : 'Copy message' }}</button>
            <a class="btn-ghost" [href]="email('Viewing request: ' + address(), viewingText())"><app-icon name="arrow" [size]="16" />Email</a>
            <a class="btn-ghost" [href]="whatsApp(viewingText())" target="_blank" rel="noopener"><app-icon name="arrow" [size]="16" />WhatsApp</a>
            <button type="button" class="btn-ghost" [disabled]="!viewing().slots[0]" (click)="addToCalendar()"><app-icon name="rows" [size]="16" />Add to calendar</button>
          </div>
          <p class="hint">The agent's phone number and email are on the listing. Nothing is sent from here: the buttons open your own email or WhatsApp with the message filled in.@if (viewing().slots[0]) { Your viewing is noted for <b>{{ slotLabel(viewing().slots[0]) }}</b>.}</p>

          <details class="group rounded-xl border border-line" [open]="viewing().checked.length > 0 || !!viewing().notes">
            <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
              <app-icon name="check" [size]="16" />What to check at the viewing
              <span class="ml-1 font-medium text-muted">{{ viewing().checked.length }} of {{ checklist().length }} done</span>
              <span class="ml-auto text-[12px] text-brand group-open:hidden">Show</span><span class="ml-auto hidden text-[12px] text-brand group-open:inline">Hide</span>
            </summary>
            <div class="flex flex-col gap-3 border-t border-line p-3">
              <ul class="flex flex-col gap-2">
                @for (item of checklist(); track item) {
                  <li><label class="flex cursor-pointer items-start gap-2.5 text-[14px]"><input class="check mt-0.5" type="checkbox" [checked]="viewing().checked.includes(item)" (change)="toggle(item)"><span [class.text-muted]="viewing().checked.includes(item)">{{ item }}</span></label></li>
                }
              </ul>
              <label class="field"><span>Your notes after the viewing</span>
                <textarea id="viewingNotes" class="input h-auto! py-2.5" rows="3" placeholder="What you liked, what worried you, what the agent said" [value]="viewing().notes" (input)="setNotes($event)"></textarea>
              </label>
              <p class="hint">Ticks and notes are kept in this browser for this house.</p>
            </div>
          </details>
        </section>

        <!-- 2. offer -->
        @if (ladder(); as l) {
          <section class="flex flex-col gap-3 border-t border-line pt-6" aria-labelledby="offer-title">
            <h3 id="offer-title" class="font-display text-[16px] font-bold"><span class="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand text-[13px] text-brand-ink">2</span>Make your offer</h3>
            <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Offer amount">
              @for (o of [{ key: 'open', label: 'Open at', amount: l.open }, { key: 'target', label: 'Aim for', amount: l.target }, { key: 'ceiling', label: 'Maximum', amount: l.ceiling }]; track o.key) {
                <button type="button" role="radio" class="chip h-auto flex-col py-2" [class.on]="step() === o.key" [attr.aria-checked]="step() === o.key" (click)="step.set($any(o.key))"><span class="text-[11.5px]">{{ o.label }}</span><b class="text-[14.5px] tabular-nums">{{ gbp(o.amount) }}</b></button>
              }
            </div>
            <label class="field"><span>Offer to the estate agent (you can change it)</span>
              <textarea id="offerMessage" class="input h-auto! py-2.5 leading-relaxed" rows="11" [value]="offerText()" (input)="offerText.set($any($event.target).value)"></textarea>
            </label>
            <div class="flex flex-wrap gap-2 print:hidden">
              <button type="button" class="btn-ghost" (click)="copy('offer', offerText())"><app-icon name="check" [size]="16" />{{ copied() === 'offer' ? 'Copied' : 'Copy message' }}</button>
              <a class="btn-ghost" [href]="email('Offer: ' + address(), offerText())"><app-icon name="arrow" [size]="16" />Email</a>
              <a class="btn-ghost" [href]="whatsApp(offerText())" target="_blank" rel="noopener"><app-icon name="arrow" [size]="16" />WhatsApp</a>
            </div>
            <p class="hint">Ring the agent with the offer first, then send this to put it in writing. Start with the opening figure and move up in steps only if it is refused. <b>Never tell the agent your maximum.</b> The message says how you are paying because that is what you set in the form; change it if it is wrong. An offer is not binding on either side until contracts are exchanged.</p>
          </section>
        }
      </div>
    </article>
  `,
})
export class NextStepsView {
  readonly address = input.required<string>();
  /** Identifies the house, so the viewing time, ticks and notes belong to it. */
  readonly houseId = input.required<string>();
  readonly facts = input.required<HouseFacts>();
  readonly ladder = input<Ladder | null>(null);

  protected readonly gbp = gbp;
  protected readonly slotLabel = slotLabel;
  protected readonly copied = signal<'viewing' | 'offer' | null>(null);
  protected readonly step = signal<'open' | 'target' | 'ceiling'>('open');
  protected readonly name = signal(readStore<{ name: string }>(BUYER_KEY, { name: '' }).name ?? '');

  private readonly store = signal(readStore<Record<string, SavedViewing>>(VIEWINGS_KEY, {}));
  protected readonly viewing = computed<SavedViewing>(() => ({ ...EMPTY, ...this.store()[this.houseId()] }));
  protected readonly checklist = computed(() => viewingChecklist(this.facts()));

  // The drafts are rewritten when what they are built from changes; in between, the buyer's own wording stays.
  // (Ticking the checklist or typing notes leaves the draft text the same, so it does not disturb an edited message.)
  private readonly viewingDraft = computed(() => viewingMessage({ address: this.address(), slots: this.viewing().slots, name: this.name() }));
  private readonly offerDraft = computed(() => {
    const l = this.ladder();
    const f = this.facts();
    if (!l) return '';
    return offerMessage({ address: this.address(), amount: l[this.step()], asking: f.inputs.asking, cash: !f.inputs.useMortgage, reasons: offerReasons(f.inputs, f.daysListed), name: this.name() });
  });
  protected readonly viewingText = linkedSignal(() => this.viewingDraft());
  protected readonly offerText = linkedSignal(() => this.offerDraft());

  constructor() {
    effect(() => writeStore(VIEWINGS_KEY, this.store()));
    effect(() => writeStore(BUYER_KEY, { name: this.name() }));
  }

  private update(change: Partial<SavedViewing>): void {
    const id = this.houseId();
    this.store.update((all) => ({ ...all, [id]: { ...EMPTY, ...all[id], ...change } }));
  }
  protected setSlot(index: 0 | 1, event: Event): void {
    const slots = [...this.viewing().slots] as [string, string];
    slots[index] = (event.target as HTMLInputElement).value;
    this.update({ slots });
  }
  protected toggle(item: string): void {
    const checked = this.viewing().checked;
    this.update({ checked: checked.includes(item) ? checked.filter((c) => c !== item) : [...checked, item] });
  }
  protected setNotes(event: Event): void {
    this.update({ notes: (event.target as HTMLTextAreaElement).value });
  }

  protected email(subject: string, body: string): string {
    return emailLink(subject, body);
  }
  protected whatsApp(body: string): string {
    return whatsAppLink(body);
  }
  protected async copy(which: 'viewing' | 'offer', text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(which);
      setTimeout(() => this.copied.set(null), 2500);
    } catch {
      /* clipboard blocked: the text is on screen to select by hand */
    }
  }
  protected addToCalendar(): void {
    const file = viewingCalendarFile(this.address(), this.viewing().slots[0], this.checklist());
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'viewing.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
