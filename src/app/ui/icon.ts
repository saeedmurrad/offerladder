import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** Small stroke icons drawn on a 24 x 24 grid. */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: `${circle(11, 11, 7)}m10 10-4.3-4.3`,
  chart: 'M4 4v16h16M8 15l3.5-4 3 2.5L19 8',
  pound: 'M17.5 7.5a4 4 0 0 0-7.5 2V13c0 3-1 5-3 7h11M7 13h8',
  shield: 'M12 3 4.5 6v6c0 4.8 3.2 7.8 7.5 9 4.3-1.2 7.5-4.2 7.5-9V6z',
  pin: `M12 21.5s-7-6.3-7-11.5a7 7 0 0 1 14 0c0 5.2-7 11.5-7 11.5z${circle(12, 10, 2.5)}`,
  rows: 'M4 6h16M4 12h16M4 18h16',
  check: `${circle(12, 12, 9)}M8.5 12.2l2.4 2.4 4.6-5`,
  sun: `${circle(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  printer: 'M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  alert: 'M12 4 2.5 20h19zM12 10v4.5M12 17.4v.2',
  sliders: `M4 7h9M17 7h3M4 17h3M11 17h9${circle(15, 7, 2)}${circle(9, 17, 2)}`,
  user: `${circle(12, 8, 4)}M4 21a8 8 0 0 1 16 0`,
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  tag: `M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z${circle(7.5, 7.5, 1.2)}`,
  key: `${circle(8, 15, 4)}M11 12l9-9M16 7l3 3`,
  ruler: 'M3 16 16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5',
} as const;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  protected readonly d = computed(() => ICONS[this.name()]);
}
