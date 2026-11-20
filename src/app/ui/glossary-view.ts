import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { GLOSSARY, GROUPS } from '../glossary';
import { Icon } from './icon';

@Component({
  selector: 'app-glossary-view',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col gap-5' },
  template: `
    <div class="card card-pad flex flex-col gap-4">
      <div>
        <p class="text-[11.5px] font-bold tracking-widest text-brand uppercase">Glossary</p>
        <h1 class="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight sm:text-[28px]">Property terms in plain English</h1>
        <p class="mt-2 max-w-2xl text-[14.5px] text-muted">{{ all.length }} terms used when buying or letting a home in England and Wales. Rules and tax rates change, so check gov.uk before relying on a figure.</p>
      </div>
      <label class="affix"><i><app-icon name="search" [size]="16" /></i>
        <input id="glossarySearch" class="input pl-9!" type="search" placeholder="Search, for example EPC, yield or leasehold" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search the glossary">
      </label>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by topic">
        <button type="button" class="chip h-9 px-3" [class.on]="group() === null" (click)="group.set(null)">All</button>
        @for (g of groups; track g) {
          <button type="button" class="chip h-9 px-3" [class.on]="group() === g" (click)="group.set(g)">{{ g }}</button>
        }
      </div>
    </div>

    @for (section of sections(); track section.group) {
      <section class="card card-pad">
        <h2 class="mb-4 font-display text-[13px] font-bold tracking-wider text-muted uppercase">{{ section.group }}</h2>
        <dl class="grid gap-x-8 gap-y-5 md:grid-cols-2">
          @for (t of section.terms; track t.term) {
            <div class="min-w-0">
              <dt class="font-display text-[15.5px] font-bold">{{ t.term }}</dt>
              <dd class="mt-1 text-[14px] leading-relaxed">{{ t.meaning }}</dd>
              @if (t.why) { <dd class="mt-1.5 border-l-2 border-brand/50 pl-2.5 text-[13.5px] leading-relaxed text-muted">{{ t.why }}</dd> }
            </div>
          }
        </dl>
      </section>
    } @empty {
      <div class="card card-pad text-muted">No term matches "{{ query() }}". Try a shorter word.</div>
    }
  `,
})
export class GlossaryView {
  protected readonly all = GLOSSARY;
  protected readonly groups = GROUPS;
  protected readonly query = signal('');
  protected readonly group = signal<string | null>(null);

  protected readonly sections = computed(() => {
    const q = this.query().trim().toLowerCase();
    const g = this.group();
    const hits = GLOSSARY.filter((t) => (!g || t.group === g) && (!q || `${t.term} ${t.meaning} ${t.why ?? ''}`.toLowerCase().includes(q)));
    return GROUPS.map((group) => ({ group, terms: hits.filter((t) => t.group === group) })).filter((s) => s.terms.length);
  });
}
