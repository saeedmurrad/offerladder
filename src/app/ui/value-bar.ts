import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** One horizontal scale showing the range the evidence supports, the three offer figures and the asking price. */
@Component({
  selector: 'app-value-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pt-9 pb-1" role="img" [attr.aria-label]="summary()">
      <div class="relative h-3 rounded-full bg-line">
        <div class="absolute inset-y-0 rounded-full bg-brand/30" [style.left.%]="pos(low())" [style.width.%]="pos(high()) - pos(low())"></div>
        <div class="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-brand" [style.left.%]="pos(mid())"></div>
        @for (m of markers(); track m.label) {
          <div class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow" [class]="m.tone" [style.left.%]="pos(m.value)"></div>
        }
        @if (asking(); as a) {
          <div class="absolute -top-8 flex -translate-x-1/2 flex-col items-center" [style.left.%]="clampPos(a)">
            <span class="rounded-md bg-ask px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide whitespace-nowrap text-white uppercase">Asking</span>
            <span class="h-5 w-0.5 bg-ask"></span>
          </div>
        }
      </div>
      <div class="mt-2.5 flex items-center justify-between gap-3 text-[11.5px] text-muted tabular-nums">
        <span>{{ short(min()) }}</span>
        <span class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span class="flex items-center gap-1.5"><i class="h-2 w-5 rounded-full bg-brand/30"></i>Range the evidence supports</span>
          <span class="flex items-center gap-1.5"><i class="h-3 w-0.5 bg-brand"></i>Middle</span>
        </span>
        <span>{{ short(max()) }}</span>
      </div>
    </div>
  `,
})
export class ValueBar {
  readonly low = input.required<number>();
  readonly mid = input.required<number>();
  readonly high = input.required<number>();
  readonly open = input.required<number>();
  readonly target = input.required<number>();
  readonly ceiling = input.required<number>();
  readonly asking = input<number | null>(null);

  protected readonly min = computed(() => Math.min(this.open(), this.low(), this.asking() ?? Infinity) * 0.96);
  protected readonly max = computed(() => Math.max(this.high(), this.ceiling(), this.asking() ?? 0) * 1.03);
  protected readonly markers = computed(() => [
    { label: 'Open', value: this.open(), tone: 'bg-muted' },
    { label: 'Aim', value: this.target(), tone: 'bg-brand' },
    { label: 'Stop', value: this.ceiling(), tone: 'bg-ink' },
  ]);
  protected readonly summary = computed(
    () =>
      `Value range ${this.short(this.low())} to ${this.short(this.high())}, middle ${this.short(this.mid())}. ` +
      `Open ${this.short(this.open())}, aim ${this.short(this.target())}, stop ${this.short(this.ceiling())}` +
      (this.asking() ? `, asking ${this.short(this.asking() as number)}.` : '.'),
  );

  protected pos(value: number): number {
    const span = this.max() - this.min();
    return span > 0 ? Math.min(100, Math.max(0, ((value - this.min()) / span) * 100)) : 0;
  }
  protected clampPos(value: number): number {
    return Math.min(94, Math.max(6, this.pos(value)));
  }
  protected short(value: number): string {
    return value >= 1_000_000 ? `£${(value / 1_000_000).toFixed(2)}m` : `£${Math.round(value / 1000)}k`;
  }
}
