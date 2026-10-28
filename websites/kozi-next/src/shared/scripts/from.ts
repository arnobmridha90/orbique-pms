// "From RMx a night": the lowest open night in the next two months across the booking types named in data-types.
import { calendar, rm } from '@shared/lib/api';
import { addDays, todayKL } from '@shared/lib/dates';

const cache = new Map<string, Promise<number | null>>();
function lowest(types: string[]) {
  const key = types.join(',');
  if (!cache.has(key)) {
    const t = todayKL();
    cache.set(key, Promise.all(types.map((type) => calendar(type, t, addDays(t, 60)))).then((all) => {
      const open = all.flat().filter((d) => d.open);
      return open.length ? Math.min(...open.map((d) => d.public)) : null;
    }));
  }
  return cache.get(key)!;
}

export function init(el: HTMLElement) {
  const types = (el.dataset.types || '').split(',').filter(Boolean);
  if (!types.length) return;
  const rate = el.querySelector<HTMLElement>('[data-from-rate]')!;
  lowest(types).then((low) => {
    if (low === null) return;
    rate.textContent = rm(low);
    el.classList.add('is-ready');
  }).catch(() => { /* the price simply stays hidden */ });
}
