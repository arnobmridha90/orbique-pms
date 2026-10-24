// The member dialog (email, then a code) and every "signed in" state on the page.
import { getMember, memberStart, memberVerify, TEST_MODE, type Member } from '@shared/lib/api';
import { lenis } from './app';

export function initMember() {
  const dlg = document.querySelector<HTMLDialogElement>('[data-member]');
  if (!dlg) return;
  const step = (name: string) => dlg.querySelectorAll<HTMLElement>('[data-step]').forEach((s) => (s.hidden = s.dataset.step !== name));
  const fEmail = dlg.querySelector<HTMLFormElement>('[data-form="email"]')!;
  const fCode = dlg.querySelector<HTMLFormElement>('[data-form="code"]')!;
  const code = fCode.querySelector<HTMLInputElement>('input[name="code"]')!;
  const slots = [...fCode.querySelectorAll<HTMLElement>('.otp-slots i')];
  let email = '';

  const open = () => {
    if (dlg.open) return;
    step(getMember() ? 'done' : 'email');
    dlg.showModal();
    lenis?.stop();
    if (!getMember()) setTimeout(() => fEmail.querySelector('input')?.focus(), 40);
  };
  dlg.addEventListener('close', () => lenis?.start());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-member-open]')) { e.preventDefault(); open(); } });

  const busy = (f: HTMLFormElement, on: boolean) => f.querySelector('button[type="submit"]')?.setAttribute('aria-busy', String(on));
  const err = (f: HTMLFormElement, msg: string) => { f.querySelector<HTMLElement>('[data-err]')!.textContent = msg; };

  fEmail.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (fEmail.elements.namedItem('email') as HTMLInputElement).value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err(fEmail, 'Please check your email address.'); return; }
    err(fEmail, ''); busy(fEmail, true);
    try {
      await memberStart(v);
      email = v;
      dlg.querySelector<HTMLElement>('[data-email]')!.textContent = v;
      dlg.querySelector<HTMLElement>('[data-test]')!.hidden = !TEST_MODE;
      step('code'); code.value = ''; paint(); code.focus();
    } catch (x) { err(fEmail, (x as Error).message); } finally { busy(fEmail, false); }
  });
  const paint = () => {
    const v = code.value.replace(/\D/g, '').slice(0, 6);
    if (v !== code.value) code.value = v;
    slots.forEach((s, i) => { s.textContent = v[i] ?? ''; s.classList.toggle('cur', i === Math.min(v.length, 5)); });
    if (v.length === 6) fCode.requestSubmit();
  };
  code.addEventListener('input', paint);
  fCode.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (code.value.length !== 6) { err(fCode, 'The code has 6 digits.'); return; }
    err(fCode, ''); busy(fCode, true);
    try { await memberVerify(email, code.value); step('done'); }
    catch (x) { err(fCode, (x as Error).message); code.select(); } finally { busy(fCode, false); }
  });
  dlg.querySelector('[data-back]')?.addEventListener('click', () => { step('email'); fEmail.querySelector('input')?.focus(); });
  dlg.querySelector('[data-resend]')?.addEventListener('click', async () => {
    err(fCode, '');
    try { await memberStart(email); err(fCode, 'We sent a new code.'); } catch (x) { err(fCode, (x as Error).message); }
  });

  // signed-in state across the page
  const reflect = (m: Member | null) => {
    document.documentElement.classList.toggle('is-member', !!m);
    document.querySelectorAll<HTMLElement>('[data-member-label]').forEach((el) => (el.textContent = m ? 'Member' : 'Sign in'));
    document.querySelectorAll<HTMLElement>('[data-member-out]').forEach((el) => (el.hidden = !!m));
    document.querySelectorAll<HTMLElement>('[data-member-in]').forEach((el) => (el.hidden = !m));
    document.querySelectorAll<HTMLElement>('[data-member-note]').forEach((el) => (el.hidden = !!m));
  };
  reflect(getMember());
  document.addEventListener('kozi:member', (e) => reflect((e as CustomEvent<Member | null>).detail));
}
