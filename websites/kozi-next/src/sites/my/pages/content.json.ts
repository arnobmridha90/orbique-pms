// /content.json: the content bundled with the site (data/content.json, as the loader checks it) and every bundled
// photo. Orbique's "Live website" panel reads it to start its draft ("Bring in what's on the website now") and to
// offer a bundled photo again after it was taken off a suite. Any site may read it (vercel.json sends the CORS header
// on Vercel; the header here covers the dev server).
import type { APIRoute } from 'astro';
import { builtinPhotos, DEFAULT_CONTENT } from '@shared/lib/content';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ...DEFAULT_CONTENT, builtinPhotos: builtinPhotos() }, null, 1), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
