// What a sheet or the photo viewer needs to hold the page still: the smooth scroller, where the page has one
// (staykozi.com's app.ts sets it; staykozi.my scrolls natively), and whether motion is reduced. Kept apart from
// app.ts so the Malaysia site's pieces don't pull in staykozi.com's page script.
import type Lenis from 'lenis';

export const scroller: { lenis: Lenis | null } = { lenis: null };
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
