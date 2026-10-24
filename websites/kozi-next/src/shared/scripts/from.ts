// "From RMx a night": the lowest open night in the next two months across the suites named in
// data-types. Members see the member price; everyone else also sees what members pay.
import { calendar, getMember, rm, saving, type Member, type SuiteType } from '@shared/lib/api';
import { addDays, todayKL } from '@shared/lib/dates';

const cache = new Map<string, Promise<{ member: number; public: number } | null>>();
function lowest(types: SuiteType[]) {
  const key = types.join(',');
  if (!cache.has(key)) {
    const t = todayKL();
    cache.set(key, Promise.all(types.map((type) => calendar(type, t, addDays(t, 60)))).then((all) => {
      const open = all.flat().filter((d) => d.open);
      return open.length ? { member: Math.min(...open.map((d) => d.member)), public: Math.min(...open.map((d) => d.public)) } : null;
    }));
  }
  return cache.get(key)!;
}

export function init(el: HTMLElement) {
  const types = (el.dataset.types || 'boutique,premium,standard').split(',') as SuiteType[];
  const rate = el.querySelector<HTMLElement>('[data-from-rate]')!;
  const mem = el.querySelector<HTMLElement>('[data-from-mem]');
  let member = !!getMember();
  let low: { member: number; public: number } | null = null;
  const paint = () => {
    if (!low) return;
    rate.textContent = rm(member ? low.member : low.public);
    if (mem) mem.textContent = !saving(low) ? '' : member ? 'Member price' : `Members from ${rm(low.member)}`;
    el.classList.add('is-ready');
  };
  lowest(types).then((l) => { low = l; paint(); }).catch(() => { /* the price simply stays hidden */ });
  document.addEventListener('kozi:member', (e) => { member = !!(e as CustomEvent<Member | null>).detail; paint(); });
}
