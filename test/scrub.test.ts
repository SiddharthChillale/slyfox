import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScrubber, luhn, verhoeff } from '../src/lib/scrub.ts';

const scrub = (text: string) => createScrubber().scrub(text);

test('checksums accept valid numbers and reject near misses', () => {
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.equal(luhn('0000000000000000'), false);
  assert.equal(verhoeff('234567890124'), true);
  assert.equal(verhoeff('234567890125'), false);
});

test('replaces emails, cards, Aadhaar, PAN, IFSC, phones and IPs', () => {
  const out = scrub(
    'Mail jane.doe@example.co.in, card 4111 1111 1111 1111, Aadhaar 2345 6789 0124, PAN ABCPE1234F, IFSC HDFC0001234, call +91 98765 43210 or (415) 555-0132, IP 192.168.1.20.',
  );
  assert.equal(
    out,
    'Mail [EMAIL_1], card [CARD_1], Aadhaar [AADHAAR_1], PAN [PAN_1], IFSC [IFSC_1], call [PHONE_1] or [PHONE_2], IP [IP_1].',
  );
});

test('leaves checksum failures and ordinary legal numbers alone', () => {
  const text = 'Card 4111 1111 1111 1112, id 2345 6789 0125, section 12.3.4, 30 days, fee of $1,250.00, version 2024.';
  assert.equal(scrub(text), text);
});

test('same value gets the same placeholder across segments', () => {
  const scrubber = createScrubber();
  assert.equal(scrubber.scrub('a@b.com'), '[EMAIL_1]');
  assert.equal(scrubber.scrub('again a@b.com, new c@d.org'), 'again [EMAIL_1], new [EMAIL_2]');
  assert.equal(scrubber.total, 2);
});
