const test = require('node:test');
const assert = require('node:assert/strict');
const NYC = require('./rules.js');

const SIGN = '3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY';

function at(y, m, d, h, min) { return NYC.nyToDate(y, m, d, h, min || 0); }
function parts(date) { return NYC.nyParts(date); }

test('combined sign is one commercial metered rule', () => {
  const { rules } = NYC.parse(SIGN);
  assert.equal(rules.length, 1);
  const r = rules[0];
  assert.equal(r.type, 'TIME_LIMIT');
  assert.equal(r.commercialOnly, true);
  assert.equal(r.metered, true);
  assert.equal(r.limitMin, 180);
  assert.deepEqual(r.times, [[7 * 60, 19 * 60]]);
  assert.equal(r.days.includes(0), false);
  assert.deepEqual([...r.days].sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.notes.some(n => /commercial loading/i.test(n)), false);
});

test('a clipped OCR "ONL" still means commercial metered parking', () => {
  const { rules } = NYC.parse('3 HOUR METERED PARKING\nCOMMERCIAL VEHICLES ONL\n7AM - 7PM\nEXCEPT SUNDAY');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].commercialOnly, true);
  assert.equal(rules[0].metered, true);
  assert.equal(rules[0].limitMin, 180);
  assert.deepEqual(rules[0].times, [[7 * 60, 19 * 60]]);
  const passenger = NYC.evaluate(rules, at(2026, 10, 28, 13, 0), {}, { commercial: false });
  assert.equal(passenger.canPark, false);
  assert.equal(parts(passenger.okAt).h, 19);
});

test('line breaks and swapped word order still combine', () => {
  const a = NYC.parse('3 HOUR METERED PARKING\nCOMMERCIAL VEHICLES ONLY\n7AM-7PM\nEXCEPT SUNDAY').rules;
  const b = NYC.parse('COMMERCIAL VEHICLES ONLY 3 HOUR METERED PARKING 7AM-7PM EXCEPT SUNDAY').rules;
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].commercialOnly, true);
  assert.equal(b[0].commercialOnly, true);
  assert.equal(a[0].limitMin, 180);
  assert.deepEqual(b[0].times, [[7 * 60, 19 * 60]]);
});

test('passenger car cannot park during the window and is ok at 7pm', () => {
  const { rules } = NYC.parse(SIGN);
  const now = at(2026, 10, 28, 10, 0); // Wednesday
  assert.equal(parts(now).dow, 3);
  const r = NYC.evaluate(rules, now, {}, { commercial: false });
  assert.equal(r.canPark, false);
  const ok = parts(r.okAt);
  assert.equal(ok.y, 2026);
  assert.equal(ok.m, 10);
  assert.equal(ok.d, 28);
  assert.equal(ok.h, 19);
  assert.equal(ok.min, 0);
});

test('commercial plate can park, 3 hour max, pay the meter', () => {
  const { rules } = NYC.parse(SIGN);
  const now = at(2026, 10, 28, 10, 0);
  const r = NYC.evaluate(rules, now, {}, { commercial: true });
  assert.equal(r.canPark, true);
  assert.equal(r.limit.minutes, 180);
  assert.equal(r.limit.metered, true);
  assert.equal(r.violationIsTimeLimit, true);
  const leave = parts(r.nextViolation);
  assert.equal(leave.h, 13);
  assert.equal(leave.min, 0);
  assert.equal(leave.d, 28);
});

test('outside the window the sign does not restrict either vehicle', () => {
  const { rules } = NYC.parse(SIGN);
  const evening = at(2026, 10, 28, 20, 0);
  const passenger = NYC.evaluate(rules, evening, {}, { commercial: false });
  const commercial = NYC.evaluate(rules, evening, {}, { commercial: true });
  assert.equal(passenger.canPark, true);
  assert.equal(passenger.limit, undefined);
  assert.equal(commercial.canPark, true);
  assert.equal(commercial.limit, undefined);
  const next = parts(passenger.nextViolation);
  assert.equal(next.d, 29);
  assert.equal(next.h, 7);
});

test('except Sunday means the sign is off on Sunday', () => {
  const { rules } = NYC.parse(SIGN);
  const sun = at(2026, 10, 25, 10, 0);
  assert.equal(parts(sun).dow, 0);
  const passenger = NYC.evaluate(rules, sun, {}, { commercial: false });
  const commercial = NYC.evaluate(rules, sun, {}, { commercial: true });
  assert.equal(passenger.canPark, true);
  assert.equal(passenger.limit, undefined);
  assert.equal(commercial.canPark, true);
  assert.equal(commercial.limit, undefined);
});

test('window is in effect at 7:00 AM and ends at 7:00 PM', () => {
  const { rules } = NYC.parse(SIGN);
  const open = NYC.evaluate(rules, at(2026, 10, 28, 7, 0), {}, { commercial: false });
  const close = NYC.evaluate(rules, at(2026, 10, 28, 19, 0), {}, { commercial: false });
  assert.equal(open.canPark, false);
  assert.equal(close.canPark, true);
});

test('equal start and end is flagged and not treated as all day', () => {
  const { rules } = NYC.parse('COMMERCIAL VEHICLES ONLY 7AM-7AM EXCEPT SUNDAY');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].badWindow, true);
  assert.ok(rules[0].notes[0].includes('7AM'));
  const wed = NYC.evaluate(rules, at(2026, 10, 28, 10, 0), {}, { commercial: false });
  assert.equal(wed.canPark, true);
  assert.equal(wed.nextViolation, null);
});

test('builder defaults to 7:00 AM–7:00 PM and rejects an equal window', () => {
  const ok = NYC.buildSignLine({
    type: 'METERED COMMERCIAL',
    hours: 3,
    from: '07:00',
    to: '19:00',
    days: 'EXCEPT SUNDAY'
  });
  assert.equal(ok.line, '3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY');
  const bad = NYC.buildSignLine({ type: 'COMMERCIAL VEHICLES ONLY', from: '07:00', to: '07:00', days: 'EXCEPT SUNDAY' });
  assert.match(bad.error, /both 7AM/);
  assert.equal(bad.line, undefined);
  const built = NYC.parse(ok.line).rules;
  const now = at(2026, 10, 28, 13, 6);
  const passenger = NYC.evaluate(built, now, {}, { commercial: false });
  assert.equal(passenger.canPark, false);
  assert.equal(parts(passenger.okAt).h, 19);
});

test('a plain metered sign is not commercial-only, and a blank line keeps signs apart', () => {
  const metered = NYC.parse('2 HOUR METERED PARKING 9AM-7PM MON-SAT').rules;
  assert.equal(metered.length, 1);
  assert.equal(metered[0].commercialOnly, undefined);
  assert.equal(metered[0].limitMin, 120);
  assert.equal(metered[0].metered, true);
  const commercial = NYC.parse('COMMERCIAL VEHICLES ONLY').rules;
  assert.equal(commercial[0].type, 'COMMERCIAL_ONLY');
  const two = NYC.parse('NO PARKING 8AM-11AM TUES\n\n3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY').rules;
  assert.equal(two.length, 2);
  assert.equal(two[0].type, 'NO_PARKING');
  assert.equal(two[1].commercialOnly, true);
});

test('ordinary no-parking and overnight windows still work', () => {
  const tue = NYC.evaluate(NYC.parse('NO PARKING 8AM-11AM TUES').rules, at(2026, 10, 27, 9, 0), {}, {});
  const wed = NYC.evaluate(NYC.parse('NO PARKING 8AM-11AM TUES').rules, at(2026, 10, 28, 9, 0), {}, {});
  assert.equal(parts(at(2026, 10, 27, 9, 0)).dow, 2);
  assert.equal(tue.canPark, false);
  assert.equal(wed.canPark, true);
  const night = NYC.parse('NO PARKING 10PM-2AM').rules[0];
  assert.deepEqual(night.times, [[22 * 60, 2 * 60]]);
  const late = NYC.evaluate([night], at(2026, 10, 28, 23, 0), {}, {});
  assert.equal(late.canPark, false);
  assert.equal(parts(late.okAt).h, 2);
});

test('street-cleaning builder text stays one timed rule', () => {
  const { rules } = NYC.parse('STREET CLEANING NO PARKING 8AM-11AM TUES');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, 'NO_PARKING');
  assert.equal(rules[0].streetCleaning, true);
  assert.deepEqual(rules[0].times, [[8 * 60, 11 * 60]]);
});

test('ocr usefulness check rejects blank and junk', () => {
  assert.equal(NYC.ocrLooksUseful(''), false);
  assert.equal(NYC.ocrLooksUseful('   \n'), false);
  assert.equal(NYC.ocrLooksUseful('asdf qwerty'), false);
  assert.equal(NYC.ocrLooksUseful('3 HOUR METERED PARKING\nCOMMERCIAL VEHICLES ONLY'), true);
  assert.equal(NYC.cleanOcr('3 hour  metered!!'), '3 HOUR METERED');
});

function side(id, text, arrow) {
  return { id, arrow: arrow || 'toward', rules: text ? NYC.parse(text).rules : [] };
}

test('front no-parking and behind meter combine, and a single sign matches', () => {
  const front = 'NO PARKING 8AM-11AM TUES';
  const behind = '2 HOUR METERED PARKING 9AM-7PM EXCEPT SUNDAY';
  const tue = at(2026, 10, 27, 10, 0);
  const both = NYC.evaluateSides([side('front', front), side('behind', behind)], tue, {}, {});
  assert.equal(both.canPark, false);
  assert.equal(parts(both.okAt).h, 11);
  assert.equal(parts(both.okAt).d, 27);
  assert.ok(both.blockedBy.some(r => r.side === 'front'));
  assert.equal(both.limitAtOk.minutes, 120);
  assert.equal(both.limitAtOk.metered, true);
  assert.equal(both.limitAtOk.side, 'behind');
  const wed = NYC.evaluateSides([side('front', front), side('behind', behind)], at(2026, 10, 28, 10, 0), {}, {});
  assert.equal(wed.canPark, true);
  assert.equal(wed.limit.minutes, 120);
  assert.equal(wed.limit.metered, true);
  assert.equal(wed.violationIsTimeLimit, true);
  assert.equal(parts(wed.nextViolation).h, 12);
  assert.equal(wed.nextRules[0].side, 'behind');
  const only = NYC.evaluate(NYC.parse(SIGN).rules, at(2026, 10, 28, 10, 0), {}, { commercial: false });
  const wrapped = NYC.evaluateSides([side('front', SIGN)], at(2026, 10, 28, 10, 0), {}, { commercial: false });
  assert.equal(only.canPark, wrapped.canPark);
  assert.equal(only.okAt.getTime(), wrapped.okAt.getTime());
});

test('a sign pointing away is ignored', () => {
  const tue = at(2026, 10, 27, 10, 0);
  const res = NYC.evaluateSides([
    side('front', 'NO PARKING 8AM-11AM TUES', 'toward'),
    side('behind', 'NO PARKING 8AM-6PM', 'away')
  ], tue, {}, {});
  assert.equal(res.canPark, false);
  assert.equal(parts(res.okAt).h, 11);
  assert.deepEqual(res.ignored.map(s => s.id), ['behind']);
  assert.ok(res.blockedBy.every(r => r.side === 'front'));
  const bothWays = NYC.evaluateSides([side('front', 'NO PARKING 8AM-11AM TUES', 'both')], tue, {}, {});
  assert.equal(bothWays.canPark, false);
  assert.equal(parts(bothWays.okAt).h, 11);
});

test('when both signs forbid parking, OK is when every sign allows it', () => {
  const res = NYC.evaluateSides([
    side('front', 'NO PARKING 8AM-11AM'),
    side('behind', 'NO PARKING 9AM-6PM')
  ], at(2026, 10, 28, 10, 0), {}, {});
  assert.equal(res.canPark, false);
  assert.equal(parts(res.okAt).h, 18);
  assert.equal(parts(res.okAt).min, 0);
  assert.deepEqual(res.blockedBy.map(r => r.side).sort(), ['behind', 'front']);
});

test('the shorter time limit applies, and ASP still suspends only street cleaning', () => {
  const limits = NYC.evaluateSides([
    side('front', '2 HOUR METERED PARKING 9AM-7PM'),
    side('behind', '1 HOUR PARKING 8AM-6PM')
  ], at(2026, 10, 28, 10, 0), {}, {});
  assert.equal(limits.canPark, true);
  assert.equal(limits.limit.minutes, 60);
  assert.equal(limits.limit.metered, false);
  assert.equal(limits.violationIsTimeLimit, true);
  assert.equal(parts(limits.nextViolation).h, 11);
  assert.equal(limits.nextRules[0].side, 'behind');
  const hol = { '2026-10-28': { asp: true, meters: false, name: 'test' } };
  const asp = NYC.evaluateSides([
    side('front', 'STREET CLEANING NO PARKING 8AM-11AM'),
    side('behind', 'NO STANDING 8AM-6PM')
  ], at(2026, 10, 28, 9, 0), hol, {});
  assert.equal(asp.canPark, false);
  assert.ok(asp.blockedBy.every(r => r.side === 'behind'));
  assert.equal(parts(asp.okAt).h, 18);
  const commercial = NYC.evaluateSides([
    side('front', SIGN),
    side('behind', 'NO PARKING 8AM-11AM')
  ], at(2026, 10, 28, 10, 0), {}, { commercial: true });
  assert.equal(commercial.canPark, false);
  assert.ok(commercial.blockedBy.every(r => r.side === 'behind'));
  assert.equal(parts(commercial.okAt).h, 11);
});
