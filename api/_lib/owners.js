/* Who may run "Set up Orbique" (bootstrap): the SHA-256 of their lower-cased email is in
 * config/platform-owners.json (emailSha256), or the email or its hash is in env PLATFORM_OWNER_EMAILS (comma separated).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let fileHashes = null;

function configHashes() {
  if (fileHashes) return fileHashes;
  const candidates = [
    new URL('../../config/platform-owners.json', import.meta.url),
    path.join(process.cwd(), 'config', 'platform-owners.json')
  ];
  for (const p of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      fileHashes = (Array.isArray(json.emailSha256) ? json.emailSha256 : []).map((h) => String(h).trim().toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h));
      return fileHashes;
    } catch (e) { /* try the next location */ }
  }
  console.error('[api] config/platform-owners.json not found; only PLATFORM_OWNER_EMAILS applies');
  fileHashes = [];
  return fileHashes;
}

export function isPlatformOwnerEmail(emailLower) {
  const hash = sha256(emailLower);
  if (configHashes().includes(hash)) return true;
  const env = String(process.env.PLATFORM_OWNER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return env.includes(emailLower) || env.includes(hash);
}
