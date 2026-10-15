/* Webhook signature checks (api/_lib/channex.js verifySignature).
 * The expected signatures were made with openssl, not with the code under test:
 *   printf '%s' '<timestamp>.<body>' | openssl dgst -sha256 -hmac '<secret>' -hex
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySignature, signature, safeEqual } from '../../api/_lib/channex.js';

const SECRET = 'whsec_test_fixture';
const OLD_SECRET = 'whsec_old_fixture';
const TS = '1760000000';
const NOW = 1760000000 * 1000;
const BODY = '{"event":"booking","payload":{"booking_id":"b1","property_id":"p1","revision_id":"r1"},"property_id":"p1","user_id":null,"timestamp":"2025-10-09T08:53:20.000Z"}';
const SIG = '30cbbbdfe54a87294d30acb4f911b86b03eedf1db231cacf9d3b258e9e0abb27';
const OLD_SIG = '95d9aacd2e6820aa2a65af9e98a809c5dfbb3d698d79dc6034724f0f2bb056f5';
const UTF8_BODY = '{"customer":{"name":"Zoë","surname":"Tan"}}';
const UTF8_SIG = '8813304fe1c3b6bd0b93c5fd06859f1ee556776a241ae98ca963a95bbef267c4';

test('signature() matches the openssl fixtures', () => {
  assert.equal(signature(SECRET, TS, BODY), SIG);
  assert.equal(signature(OLD_SECRET, TS, BODY), OLD_SIG);
  assert.equal(signature(SECRET, TS, Buffer.from(UTF8_BODY, 'utf8')), UTF8_SIG);
});

test('a correct signature passes, as a string or as raw bytes', () => {
  assert.equal(verifySignature(SECRET, BODY, TS, SIG, { now: NOW }), true);
  assert.equal(verifySignature(SECRET, Buffer.from(BODY), TS, SIG, { now: NOW }), true);
  assert.equal(verifySignature(SECRET, Buffer.from(UTF8_BODY, 'utf8'), TS, UTF8_SIG, { now: NOW }), true);
  assert.equal(verifySignature(SECRET, BODY, TS, SIG.toUpperCase(), { now: NOW }), true);
});

test('during key rotation either of two comma-separated signatures passes', () => {
  assert.equal(verifySignature(SECRET, BODY, TS, `${OLD_SIG},${SIG}`, { now: NOW }), true);
  assert.equal(verifySignature(SECRET, BODY, TS, `${SIG}, ${OLD_SIG}`, { now: NOW }), true);
  assert.equal(verifySignature(OLD_SECRET, BODY, TS, `${SIG},${OLD_SIG}`, { now: NOW }), true);
  assert.equal(verifySignature(SECRET, BODY, TS, OLD_SIG, { now: NOW }), false);
});

test('a changed body, timestamp or secret fails', () => {
  assert.equal(verifySignature(SECRET, BODY + ' ', TS, SIG, { now: NOW }), false);
  // re-serialised JSON is not the same bytes
  assert.equal(verifySignature(SECRET, JSON.stringify(JSON.parse(BODY), null, 1), TS, SIG, { now: NOW }), false);
  assert.equal(verifySignature(SECRET, BODY, '1760000001', SIG, { now: NOW }), false);
  assert.equal(verifySignature('whsec_other', BODY, TS, SIG, { now: NOW }), false);
  // the same text in another encoding
  assert.equal(verifySignature(SECRET, Buffer.from(UTF8_BODY, 'latin1'), TS, UTF8_SIG, { now: NOW }), false);
});

test('timestamps more than 300 s away are refused', () => {
  assert.equal(verifySignature(SECRET, BODY, TS, SIG, { now: NOW + 300 * 1000 }), true);
  assert.equal(verifySignature(SECRET, BODY, TS, SIG, { now: NOW - 300 * 1000 }), true);
  assert.equal(verifySignature(SECRET, BODY, TS, SIG, { now: NOW + 301 * 1000 }), false);
  assert.equal(verifySignature(SECRET, BODY, TS, SIG, { now: NOW - 301 * 1000 }), false);
  assert.equal(verifySignature(SECRET, BODY, TS, SIG), false, 'the fixture is from 2025, far outside the window');
});

test('missing or malformed inputs fail without throwing', () => {
  for (const [secret, body, ts, sig] of [
    ['', BODY, TS, SIG], [SECRET, null, TS, SIG], [SECRET, BODY, '', SIG], [SECRET, BODY, 'abc', SIG],
    [SECRET, BODY, '1760000000.5', SIG], [SECRET, BODY, TS, ''], [SECRET, BODY, TS, undefined],
    [SECRET, BODY, TS, SIG.slice(0, 63)], [SECRET, BODY, TS, SIG + '00'], [SECRET, BODY, TS, 'zz' + SIG.slice(2)], [SECRET, BODY, TS, ',,,']
  ]) assert.equal(verifySignature(secret, body, ts, sig, { now: NOW }), false);
});

test('safeEqual compares shared secrets', () => {
  assert.equal(safeEqual('token-123', 'token-123'), true);
  assert.equal(safeEqual('token-123', 'token-124'), false);
  assert.equal(safeEqual('token-123', 'token-1234'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'x'), false);
});
