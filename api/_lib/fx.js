/* Rate plans sold in another currency than the building's (Vrbo takes no MYR through Channex): which currency, and the
 * multiplier from the building's currency. Used when sending rates (channex-sync.js) and creating rate plans
 * (channex-setup.js). The rates themselves come from the nightly job (channex-sync.js refreshFx, blob fxRates).
 */
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** The plan's own currency when it differs from the building's (base), else ''. */
export function foreignCurrency(plan, base) {
  const cur = plan && typeof plan.currency === 'string' ? plan.currency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(cur) && cur !== String(base || 'MYR').toUpperCase() ? cur : '';
}

/**
 * The rate a plan sends in its own currency. A plan with currency (e.g. 'USD', for a site such as Vrbo that takes no
 * MYR) different from the building's has its rates set in the building's currency and converted with the workspace's
 * fxRates blob {base, rates: {USD: 0.2112}, at}. -> a multiplier, 1 for a plan in the building's currency, null when
 * the rate to convert with is missing or stale (more than 7 days old): the night is then not sold (stop_sell).
 */
export function fxFactor(plan, base, fx, now = Date.now()) {
  const cur = foreignCurrency(plan, base);
  const b = String(base || 'MYR').toUpperCase();
  if (!cur) return 1;
  if (!fx || typeof fx !== 'object' || String(fx.base || '').toUpperCase() !== b || !fx.rates) return null;
  const r = num(fx.rates[cur]);
  const at = Date.parse(fx.at || '');
  if (!(r > 0) || !Number.isFinite(at) || now - at > 7 * 86400000) return null;
  return r;
}
