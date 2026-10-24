// A country card on staykozi.com: the sky over its first city right now, and the time there.
import { skyState, type City } from '@shared/lib/sun';
import { applySky } from './sky';

export function init(card: HTMLElement) {
  const city: City = { name: card.dataset.city!, lat: +card.dataset.lat!, lon: +card.dataset.lon!, tz: card.dataset.tz!, utc: +card.dataset.utc! };
  const time = card.querySelector<HTMLElement>('[data-cc-time]');
  const fmt = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: city.tz });
  const tick = () => {
    applySky(card, skyState(new Date(), city));
    if (time) time.textContent = fmt.format(new Date()).replace(/\s/g, ' ').toLowerCase();
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000) + 50);
}
