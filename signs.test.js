const test = require('node:test');
const assert = require('node:assert/strict');
const Signs = require('./signs.js');
const NYC = require('./rules.js');

const CITY = '3 HMP COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY <-> (SUPERSEDES PS-1C)';

function at(y, m, d, h, min) { return NYC.nyToDate(y, m, d, h, min || 0); }
function parts(date) { return NYC.nyParts(date); }

test('city 3 HMP commercial sign expands into the combined rule', () => {
  const ex = Signs.expandCityDescription(CITY);
  assert.equal(ex.glyph, 'both');
  assert.match(ex.text, /3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY/);
  assert.doesNotMatch(ex.text, /SUPERSEDES|<->/);
  const rules = NYC.parse(ex.text).rules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].commercialOnly, true);
  assert.equal(rules[0].limitMin, 180);
  assert.equal(rules[0].metered, true);
  const wed = at(2026, 10, 28, 10, 0);
  const passenger = NYC.evaluate(rules, wed, {}, { commercial: false });
  assert.equal(passenger.canPark, false);
  assert.equal(parts(passenger.okAt).h, 19);
  const commercial = NYC.evaluate(rules, wed, {}, { commercial: true });
  assert.equal(commercial.canPark, true);
  assert.equal(commercial.limit.minutes, 180);
});

test('single arrows and locator plaques are recognized', () => {
  assert.equal(Signs.expandCityDescription('NO STOPPING ANYTIME -->').glyph, 'single');
  assert.equal(Signs.expandCityDescription('BUS STOP NO STANDING <----->').glyph, 'both');
  assert.equal(Signs.isLocator('PAY-BY-CELL LOCATOR NUMBER'), true);
  assert.equal(Signs.isLocator(CITY), false);
});

test('a compass arrow is toward the pin only on that side', () => {
  const sign = { x: 0, y: 0, compass: 'East' };
  assert.equal(Signs.compassRelative(sign, { x: 10, y: 0 }), 'toward');
  assert.equal(Signs.compassRelative(sign, { x: -10, y: 1 }), 'away');
  const pole = Signs.signsForSlot([
    { description: '3 HMP COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY -->', compass: 'West', x: 100, y: 0 },
    { description: 'PAY-BY-CELL LOCATOR NUMBER', x: 100, y: 0 }
  ], { x: 50, y: 0 });
  assert.equal(pole.arrow, 'toward');
  assert.match(pole.text, /3 HOUR METERED PARKING/);
  const away = Signs.signsForSlot([
    { description: 'NO STOPPING ANYTIME -->', compass: 'East', x: 0, y: 0 }
  ], { x: -20, y: 0 });
  assert.equal(away, null);
});

test('pin distance and front/behind poles follow the curb', () => {
  const signs = [
    { description: 'NO PARKING 8AM-11AM', dist: 200, x: 100, y: 0 },
    { description: '2 HOUR METERED PARKING 9AM-7PM', dist: 400, x: 300, y: 0 },
    { description: 'NO STANDING ANYTIME <->', dist: 600, x: 500, y: 0 }
  ];
  const pinDist = Signs.estimatePinDistance(signs, { x: 300, y: 0 });
  assert.ok(Math.abs(pinDist - 400) < 1);
  const facedHigh = Signs.pickFrontBehind(signs, 300, true);
  assert.equal(facedHigh.behind.dist, 200);
  assert.equal(facedHigh.front.dist, 400);
  const facedLow = Signs.pickFrontBehind(signs, 300, false);
  assert.equal(facedLow.front.dist, 200);
  assert.equal(facedLow.behind.dist, 400);
  assert.equal(Signs.estimatePinDistance([
    { description: 'A', dist: 10, x: 5, y: 5 },
    { description: 'B', dist: 80, x: 5, y: 6 }
  ], { x: 5, y: 5 }), null);
});

test('share link round-trips and the calendar file has the move time', () => {
  const state = {
    v: 1,
    front: 'NO PARKING 8AM-11AM TUES',
    frontArrow: 'toward',
    behind: '2 HOUR METERED PARKING 9AM-7PM EXCEPT SUNDAY',
    behindArrow: 'both',
    commercial: false,
    lat: 40.7434,
    lon: -73.9942,
    label: 'West 23 Street'
  };
  const back = Signs.decodeState(Signs.encodeState(state));
  assert.deepEqual(back, state);
  const text = Signs.shareSummary({
    verdictLine: 'CANNOT PARK NOW',
    whenLine: 'OK at Wed, Oct 28, 7:00 PM',
    address: state.label,
    front: state.front,
    frontArrow: state.frontArrow,
    behind: state.behind,
    behindArrow: state.behindArrow,
    url: 'https://example.test/#p=abc'
  });
  assert.match(text, /^ParkHero — NYC parking sign checker/);
  assert.match(text, /CANNOT PARK NOW/);
  assert.match(text, /NO PARKING 8AM-11AM TUES/);
  assert.match(text, /2 HOUR METERED PARKING/);
  assert.match(text, /#p=abc/);
  const when = new Date('2026-10-28T23:00:00.000Z');
  const ics = Signs.icsEvent(when, 'Move the car', 'Parking restriction starts');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20261028T230000Z/);
  assert.match(ics, /SUMMARY:Move the car/);
});

// ---- v2 short links + friendly share text ----
const OLD_V1 = 'eyJ2IjoxLCJmcm9udCI6Ik5PIFBBUktJTkcgN0FNLTdQTSBFWENFUFQgU1VOREFZIiwiZnJvbnRBcnJvdyI6InRvd2FyZCIsImJlaGluZCI6IiIsImJlaGluZEFycm93IjoiYXdheSIsImNvbW1lcmNpYWwiOmZhbHNlLCJsYXQiOjQwLjgwOTU0MywibG9uIjotNzMuOTQ3MDE4LCJhY2MiOjE1LCJsYWJlbCI6IjE2NSBXRVNUIDEyNiBTVFJFRVQsIE5ldyBZb3JrLCBOWSwgVVNBIn0';

test('old v1 #p= links still decode', () => {
  const st = Signs.stateFromHash('#p=' + OLD_V1);
  assert.equal(st.v, 1);
  assert.equal(st.front, 'NO PARKING 7AM-7PM EXCEPT SUNDAY');
  assert.equal(st.behindArrow, 'away');
  assert.equal(st.lat, 40.809543);
  assert.equal(st.label, '165 WEST 126 STREET, New York, NY, USA');
  // percent-encoded variant too
  assert.equal(Signs.stateFromHash('#p=' + encodeURIComponent(OLD_V1)).front, st.front);
  assert.equal(Signs.stateFromHash(''), null);
});

test('v2 short link round-trips and drops defaults', () => {
  const state = {
    v: 1,
    front: 'NO PARKING 7AM-7PM\n\n2 HOUR METERED PARKING 9AM-7PM EXCEPT SUNDAY',
    frontArrow: 'away',
    behind: 'NO STANDING W/ ARROW; 8AM-6PM + 100% ~',
    behindArrow: 'both',
    commercial: true,
    lat: 40.8095431234,
    lon: -73.9470189876,
    acc: 14,
    label: '165 WEST 126 STREET, Manhattan, New York, NY, USA'
  };
  const hash = Signs.shareHash(state);
  assert.ok(hash.startsWith('s='));
  assert.ok(!/label|acc|toward|165/.test(hash), hash);
  const back = Signs.stateFromHash('#' + hash);
  assert.deepEqual(back, {
    v: 2, front: state.front, frontArrow: 'away', behind: state.behind, behindArrow: 'both',
    commercial: true, lat: 40.80954, lon: -73.94702
  });
  // defaults and empty fields are omitted
  const simple = { front: 'NO PARKING 7AM-7PM EXCEPT SUNDAY', frontArrow: 'toward', behind: '', behindArrow: 'toward', commercial: false, lat: 40.809543, lon: -73.947018 };
  assert.equal(Signs.shareHash(simple), 's=NO+PARKING+7AM-7PM+EXCEPT+SUNDAY;;;40.80954;-73.94702');
  assert.equal(Signs.shareHash({ front: 'NO STANDING ANYTIME', frontArrow: 'toward', commercial: false }), 's=NO+STANDING+ANYTIME');
  const noLoc = Signs.stateFromHash('#s=NO+STANDING+ANYTIME');
  assert.equal(noLoc.front, 'NO STANDING ANYTIME');
  assert.equal(noLoc.frontArrow, 'toward');
  assert.equal(noLoc.lat, undefined);
  // whole fragment percent-encoded by a messaging app
  assert.deepEqual(Signs.stateFromHash('#s=' + encodeURIComponent('NO+PARKING+7AM-7PM+EXCEPT+SUNDAY;;;40.80954;-73.94702')), Signs.stateFromHash('#' + Signs.shareHash(simple)));
  // much shorter than v1
  assert.ok(Signs.shareHash(simple).length < OLD_V1.length / 3);
});

test('tidyAddress makes short, friendly addresses', () => {
  assert.equal(Signs.tidyAddress('165 WEST 126 STREET, Manhattan, New York, NY, USA'), '165 W 126th St, Manhattan');
  assert.equal(Signs.tidyAddress('165 WEST 126 STREET, New York, NY, USA'), '165 W 126th St, NYC');
  assert.equal(Signs.tidyAddress('136 West 23 Street, Manhattan, New York, NY, USA'), '136 W 23rd St, Manhattan');
  assert.equal(Signs.tidyAddress('500 EAST 11 AVENUE, Brooklyn, NY, USA'), '500 E 11th Ave, Brooklyn');
  assert.equal(Signs.tidyAddress(''), '');
});

test('friendlyRule speaks plain English', () => {
  const R = require('./rules.js');
  const one = t => Signs.friendlyRule(R.parse(t).rules[0]);
  assert.equal(one('NO PARKING 7AM-7PM EXCEPT SUNDAY'), 'No parking 7 AM to 7 PM, Mon–Sat');
  assert.equal(one('NO STANDING ANYTIME'), 'No standing anytime');
  assert.equal(one('2 HOUR METERED PARKING 8AM-7PM MON THRU FRI'), '2-hour metered parking 8 AM to 7 PM, Mon–Fri');
  assert.match(one('NO PARKING 8:30AM-10AM TUES & FRI'), /no parking 8:30 AM to 10 AM, Tue & Fri$/i);
});

function sideRules(text, side) {
  const R = require('./rules.js');
  return R.parse(text).rules.map(r => Object.assign(r, { side }));
}

test('share text: CAN park', () => {
  const text = Signs.shareText({
    canPark: true,
    now: new Date('2026-10-29T21:30:00-04:00'),      // Thu 9:30 PM
    when: new Date('2026-10-30T07:00:00-04:00'),     // Fri 7:00 AM
    rules: sideRules('NO PARKING 7AM-7PM EXCEPT SUNDAY', 'front'),
    address: '165 WEST 126 STREET, Manhattan, New York, NY, USA',
    url: 'https://example.test/#s=abc',
    linkInText: true
  });
  assert.equal(text,
    '✅ You can park here until 7:00 AM tomorrow (Fri)\n' +
    '📍 165 W 126th St, Manhattan\n' +
    'No parking 7 AM to 7 PM, Mon–Sat.\n\n' +
    'Check it in ParkHero: https://example.test/#s=abc');
  assert.ok(!/toward|away|←|→|CAN PARK NOW|USA/.test(text));
});

test('share text: CANNOT park, both signs apply, no link when url passed separately', () => {
  const text = Signs.shareText({
    canPark: false,
    now: new Date('2026-10-30T14:15:00-04:00'),
    when: new Date('2026-10-30T19:00:00-04:00'),
    rules: sideRules('NO PARKING 7AM-7PM EXCEPT SUNDAY', 'front').concat(sideRules('2 HOUR METERED PARKING 9AM-7PM EXCEPT SUNDAY', 'behind')),
    address: '136 West 23 Street, Manhattan, New York, NY, USA',
    url: 'https://example.test/#s=abc'
  });
  assert.equal(text,
    '🚫 No parking here right now. OK after 7:00 PM today.\n' +
    '📍 136 W 23rd St, Manhattan\n' +
    'Front sign: No parking 7 AM to 7 PM, Mon–Sat.\n' +
    'Back sign: 2-hour metered parking 9 AM to 7 PM, Mon–Sat.');
  assert.ok(!/example\.test/.test(text));
  assert.ok(text.split('\n').length <= 4);
});

test('share text: move soon, empty bits omitted', () => {
  const text = Signs.shareText({
    canPark: true,
    now: new Date('2026-11-03T08:05:00-05:00'),
    when: new Date('2026-11-03T08:30:00-05:00'),
    rules: sideRules('NO PARKING 8:30AM-10AM TUES & FRI', 'behind'),
    address: null
  });
  assert.equal(text.split('\n')[0], '⚠️ You can park here, but move by 8:30 AM today (25 min left)');
  assert.ok(!/📍/.test(text));
  assert.match(text, /8:30 AM to 10 AM, Tue & Fri\.$/);
  assert.ok(!/Front sign|Back sign/.test(text));
});

test('whenText uses relative day words', () => {
  const now = new Date('2026-10-29T10:00:00-04:00'); // Thu
  assert.equal(Signs.whenText(new Date('2026-10-29T19:00:00-04:00'), now), '7:00 PM today');
  assert.equal(Signs.whenText(new Date('2026-10-29T22:00:00-04:00'), now), '10:00 PM tonight');
  assert.equal(Signs.whenText(new Date('2026-10-30T07:00:00-04:00'), now), '7:00 AM tomorrow (Fri)');
  assert.equal(Signs.whenText(new Date('2026-11-03T08:00:00-05:00'), now), '8:00 AM on Tuesday');
  assert.equal(Signs.whenText(new Date('2026-11-09T09:00:00-05:00'), now), '9:00 AM on Mon, Nov 9');
});

// ---- commercial plates ----
test('commercial switch changes the verdict only on commercial-aware signs', () => {
  const now = new Date('2026-10-30T10:00:00-04:00'); // Fri, restricted hours
  const ev = (t, commercial) => NYC.evaluate(NYC.parse(t).rules, now, {}, { commercial });
  const hmp = '3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY';
  assert.equal(ev(hmp, false).canPark, false);
  assert.equal(ev(hmp, true).canPark, true);
  assert.equal(ev(hmp, true).limit.minutes, 180);
  assert.equal(ev('COMMERCIAL VEHICLES ONLY 7AM-7PM', false).canPark, false);
  assert.equal(ev('COMMERCIAL VEHICLES ONLY 7AM-7PM', true).canPark, true);
  const a = ev('NO PARKING 7AM-7PM', false), b = ev('NO PARKING 7AM-7PM', true);
  assert.equal(a.canPark, b.canPark);
  assert.equal(+a.okAt, +b.okAt);
});

test('vehicleMatters flags only commercial-aware rules', () => {
  const rules = t => NYC.parse(t).rules;
  assert.equal(Signs.vehicleMatters(rules('3 HOUR METERED PARKING COMMERCIAL VEHICLES ONLY 7AM-7PM EXCEPT SUNDAY')), true);
  assert.equal(Signs.vehicleMatters(rules('COMMERCIAL VEHICLES ONLY 7AM-7PM')), true);
  assert.equal(Signs.vehicleMatters(rules('NO PARKING 7AM-7PM')), false);
  assert.equal(Signs.vehicleMatters(rules('2 HOUR METERED PARKING 9AM-7PM EXCEPT SUNDAY')), false);
  assert.equal(Signs.vehicleMatters([]), false);
});

test('share text names the vehicle only when the sign cares', () => {
  const now = new Date('2026-10-30T10:00:00-04:00');
  const rules = t => NYC.parse(t).rules.map(r => Object.assign(r, { side: 'front' }));
  const com = Signs.shareText({ canPark: true, now, rules: rules('COMMERCIAL VEHICLES ONLY 7AM-7PM'), commercial: true });
  assert.match(com, /\(For commercial plates\.\)$/);
  const pas = Signs.shareText({ canPark: false, now, when: new Date('2026-10-30T19:00:00-04:00'), rules: rules('COMMERCIAL VEHICLES ONLY 7AM-7PM'), commercial: false });
  assert.match(pas, /\(For a passenger car\.\)$/);
  const plain = Signs.shareText({ canPark: false, now, when: new Date('2026-10-30T19:00:00-04:00'), rules: rules('NO PARKING 7AM-7PM'), commercial: true });
  assert.ok(!/commercial|passenger/i.test(plain), plain);
});

// ---- garage referral links ----
test('garageWindow: until legal again, else now + 2h', () => {
  const now = new Date('2026-10-30T10:15:22-04:00');
  let w = Signs.garageWindow(now, new Date('2026-10-30T19:00:00-04:00'));
  assert.equal(w.known, true);
  assert.equal(w.start.toISOString(), '2026-10-30T14:15:00.000Z');
  assert.equal(w.end.toISOString(), '2026-10-30T23:00:00.000Z');
  w = Signs.garageWindow(now, null);
  assert.equal(w.known, false);
  assert.equal(w.end.toISOString(), '2026-10-30T16:15:00.000Z');
  w = Signs.garageWindow(now, new Date('2026-11-01T10:00:00-05:00')); // > 24h away
  assert.equal(w.known, false);
  assert.equal(w.end - w.start, 2 * 3600e3);
  w = Signs.garageWindow(now, new Date('2026-10-30T10:00:00-04:00')); // already past
  assert.equal(w.known, false);
  w = Signs.garageWindow(now, new Date('2026-10-30T10:40:00-04:00')); // too short: at least 1h
  assert.equal(w.end.toISOString(), '2026-10-30T15:15:00.000Z');
  w = Signs.garageWindow(now, new Date('2026-10-30T13:05:00-04:00')); // rounds up to 15 min
  assert.equal(w.end.toISOString(), '2026-10-30T17:15:00.000Z');
});

test('garageLinks builds prefilled SpotHero and ParkWhiz searches', () => {
  const links = Signs.garageLinks({
    lat: 40.809543, lon: -73.947018,
    address: '165 WEST 126 STREET, New York, NY, USA, Manhattan',
    now: new Date('2026-10-30T10:15:22-04:00'),
    legalAt: new Date('2026-10-30T19:00:00-04:00'),
    affiliate: { spothero: '', parkwhiz: '' }
  });
  const sh = new URL(links.spothero);
  assert.equal(sh.origin + sh.pathname, 'https://spothero.com/search');
  assert.equal(sh.searchParams.get('latitude'), '40.80954');
  assert.equal(sh.searchParams.get('longitude'), '-73.94702');
  assert.equal(sh.searchParams.get('starts'), '2026-10-30T10:15');
  assert.equal(sh.searchParams.get('ends'), '2026-10-30T19:00');
  assert.equal(sh.searchParams.get('search_string'), '165 W 126th St, Manhattan, NY');
  const pw = new URL(links.parkwhiz);
  assert.equal(pw.origin + pw.pathname, 'https://www.parkwhiz.com/destination/Parking-Near-165-W-126th-St/');
  assert.equal(pw.searchParams.get('lat'), '40.80954');
  assert.equal(pw.searchParams.get('lng'), '-73.94702');
  assert.equal(pw.searchParams.get('start'), '2026-10-30T10:15:00-04:00');
  assert.equal(pw.searchParams.get('end'), '2026-10-30T19:00:00-04:00');
  // no affiliate params when IDs are empty
  assert.ok(!/pwa=|aff_id|app\.link/.test(links.spothero + links.parkwhiz));
  assert.equal(links.endKnown, true);
});

test('garageLinks: winter offset, no address, no location', () => {
  const links = Signs.garageLinks({ lat: 40.7, lon: -74, now: new Date('2026-12-01T17:00:00Z'), legalAt: null });
  const pw = new URL(links.parkwhiz);
  assert.ok(pw.pathname.startsWith('/destination/NYC-Parking/'));
  assert.equal(pw.searchParams.get('start'), '2026-12-01T12:00:00-05:00');
  assert.equal(pw.searchParams.get('end'), '2026-12-01T14:00:00-05:00');
  assert.equal(new URL(links.spothero).searchParams.get('search_string'), null);
  assert.equal(links.generic, false);
  assert.equal(Signs.garageLinks({ lat: null, lon: null, now: new Date(), fallback: false }), null);
});

test('garageLinks without coordinates falls back to a New York search', () => {
  const now = new Date('2026-10-30T10:15:00-04:00'), legalAt = new Date('2026-10-30T19:00:00-04:00');
  for (const loc of [{}, { lat: null, lon: null }, { lat: '', lon: '' }, { lat: NaN, lon: 1 }]) {
    const l = Signs.garageLinks(Object.assign({ now, legalAt }, loc));
    assert.equal(l.generic, true);
    const sh = new URL(l.spothero), pw = new URL(l.parkwhiz);
    assert.equal(sh.origin + sh.pathname, 'https://spothero.com/search');
    assert.equal(sh.searchParams.get('search_string'), 'New York, NY');
    assert.equal(sh.searchParams.get('latitude'), null);
    assert.equal(sh.searchParams.get('starts'), '2026-10-30T10:15');
    assert.equal(sh.searchParams.get('ends'), '2026-10-30T19:00');
    assert.equal(pw.pathname, '/destination/New-York-NY/');
    assert.equal(pw.searchParams.get('lat'), '40.758');
    assert.equal(pw.searchParams.get('lng'), '-73.9855');
    assert.equal(pw.searchParams.get('end'), '2026-10-30T19:00:00-04:00');
  }
  // affiliate still applied on the fallback
  const a = Signs.garageLinks({ now, legalAt, affiliate: { parkwhiz: 'pa-23' } });
  assert.equal(new URL(a.parkwhiz).searchParams.get('pwa'), 'pa-23');
});

test('garageLinks appends affiliate IDs only when set', () => {
  const base = { lat: 40.80954, lon: -73.94702, now: new Date('2026-10-30T10:15:00-04:00'), legalAt: null };
  const l = Signs.garageLinks(Object.assign({ affiliate: { spothero: '1234', parkwhiz: 'pa-23' } }, base));
  assert.equal(new URL(l.parkwhiz).searchParams.get('pwa'), 'pa-23');
  const sh = new URL(l.spothero);
  assert.equal(sh.hostname, 'spothero.app.link');
  assert.match(sh.searchParams.get('$affiliate_json'), /aff_id=1234/);
  assert.equal(sh.searchParams.get('latitude'), '40.80954');
  assert.equal(sh.searchParams.get('starts'), '2026-10-30T10:15');
  const pref = Signs.garageLinks(Object.assign({ affiliate: { spothero: 'https://spothero.pxf.io/c/1/2/3?u=' } }, base));
  assert.ok(pref.spothero.startsWith('https://spothero.pxf.io/c/1/2/3?u=https%3A%2F%2Fspothero.com%2Fsearch%3F'));
  assert.equal(new URL(pref.parkwhiz).searchParams.get('pwa'), null);
});

test('garagePlan: expanded when blocked or under 2h, collapsed otherwise', () => {
  const ev = (t, now) => NYC.evaluate(NYC.parse(t).rules, now, {}, { commercial: false });
  const plan = (t, now) => { const r = ev(t, now); return Signs.garagePlan({ canPark: r.canPark, nextViolation: r.nextViolation, okAt: r.okAt, now }); };
  // Fri 10:15 AM under NO PARKING 7AM-7PM: blocked, book until 7 PM
  let now = new Date('2026-10-30T10:15:00-04:00');
  let p = plan('NO PARKING 7AM-7PM EXCEPT SUNDAY', now);
  assert.equal(p.mode, 'blocked'); assert.equal(p.expanded, true);
  assert.equal(+p.until, +new Date('2026-10-30T19:00:00-04:00'));
  // Fri 6:10 PM under NO PARKING 7PM-10PM: 50 min left -> soon, expanded
  now = new Date('2026-10-30T18:10:00-04:00');
  p = Signs.garagePlan({ canPark: true, nextViolation: ev('NO PARKING 7PM-10PM', now).nextViolation, afterOkAt: new Date('2026-10-30T22:00:00-04:00'), now });
  assert.equal(p.mode, 'soon'); assert.equal(p.expanded, true);
  assert.equal(+p.until, +new Date('2026-10-30T22:00:00-04:00'));
  // exactly 2h left still counts as soon
  p = Signs.garagePlan({ canPark: true, nextViolation: new Date(+now + 2 * 3600e3), now });
  assert.equal(p.mode, 'soon');
  // Fri 8:15 PM under NO PARKING 7AM-7PM: fine until Sat 7 AM -> collapsed, window ends at the next violation
  now = new Date('2026-10-30T20:15:00-04:00');
  p = plan('NO PARKING 7AM-7PM EXCEPT SUNDAY', now);
  assert.equal(p.mode, 'later'); assert.equal(p.expanded, false);
  assert.equal(+p.until, +new Date('2026-10-31T07:00:00-04:00'));
  const l = Signs.garageLinks({ lat: 40.8, lon: -73.9, now, legalAt: p.until });
  assert.equal(new URL(l.spothero).searchParams.get('starts'), '2026-10-30T20:15');
  assert.equal(new URL(l.spothero).searchParams.get('ends'), '2026-10-31T07:00');
  assert.equal(l.endKnown, true);
  // no restriction at all: collapsed, no end -> now + 2h
  p = Signs.garagePlan({ canPark: true, nextViolation: null, now });
  assert.equal(p.mode, 'later'); assert.equal(p.until, null);
  const l2 = Signs.garageLinks({ lat: 40.8, lon: -73.9, now, legalAt: p.until });
  assert.equal(new URL(l2.spothero).searchParams.get('ends'), '2026-10-30T22:15');
  assert.equal(l2.endKnown, false);
  // next violation more than 24h away -> now + 2h, rounded to 15 min
  p = Signs.garagePlan({ canPark: true, nextViolation: new Date(+now + 30 * 3600e3), now: new Date('2026-10-30T20:08:00-04:00') });
  const l3 = Signs.garageLinks({ lat: 40.8, lon: -73.9, now: new Date('2026-10-30T20:08:00-04:00'), legalAt: p.until });
  assert.equal(new URL(l3.parkwhiz).searchParams.get('end'), '2026-10-30T22:15:00-04:00');
});

test('themeFor resolves auto/light/dark and the bar colour', () => {
  assert.deepEqual(Signs.themeFor('auto', true), { pref: 'auto', mode: 'dark', color: '#000000' });
  assert.deepEqual(Signs.themeFor('auto', false), { pref: 'auto', mode: 'light', color: '#f2f3f7' });
  assert.deepEqual(Signs.themeFor('light', true), { pref: 'light', mode: 'light', color: '#f2f3f7' });
  assert.deepEqual(Signs.themeFor('dark', false), { pref: 'dark', mode: 'dark', color: '#000000' });
  assert.equal(Signs.themeFor(null, false).pref, 'auto');
  assert.equal(Signs.themeFor('purple', true).mode, 'dark');
});

// ---- I parked here: countdown and state ----
const ASPH = require('./asp.json').holidays;
const carAt = (text, parkedAt, extra) => Signs.makeCar(Object.assign({ parkedAt, lat: 40.80954, lon: -73.94702, address: '165 W 126th St, Manhattan', sides: [{ id: 'front', arrow: 'toward', rules: NYC.parse(text).rules }] }, extra || {}));
const T = s => new Date(s);

test('makeCar stores a JSON-safe snapshot', () => {
  const c = carAt('NO PARKING 7AM-7PM EXCEPT SUNDAY', '2026-10-30T20:15:00-04:00', { commercial: true, lat: '', lon: undefined });
  const back = JSON.parse(JSON.stringify(c));
  assert.deepEqual(back, c);
  assert.equal(c.lat, null); assert.equal(c.lon, null); assert.equal(c.commercial, true);
  assert.equal(c.parkedAt, '2026-10-31T00:15:00.000Z');
  assert.equal(Signs.carHasRules(c), true);
  assert.equal(Signs.carHasRules(Signs.makeCar({ sides: [{ id: 'front', arrow: 'away', rules: NYC.parse('NO PARKING ANYTIME').rules }] })), false);
});

test('carStatus counts down to the next violation, with green/amber/red tones', () => {
  const car = carAt('NO PARKING 7AM-7PM EXCEPT SUNDAY', '2026-10-30T20:15:00-04:00');
  let s = Signs.carStatus(car, T('2026-10-30T22:48:00-04:00'), ASPH, NYC);
  assert.equal(s.state, 'ok');
  assert.equal(+s.deadline, +T('2026-10-31T07:00:00-04:00'));
  let v = Signs.carView(s, T('2026-10-30T22:48:00-04:00'));
  assert.equal(v.tone, 'green'); assert.equal(v.title, 'Move by 7:00 AM Sat'); assert.equal(v.detail, '8h 12m left');
  v = Signs.carView(Signs.carStatus(car, T('2026-10-31T05:30:00-04:00'), ASPH, NYC), T('2026-10-31T05:30:00-04:00'));
  assert.equal(v.tone, 'amber'); assert.equal(v.detail, '1h 30m left'); assert.equal(v.soon, true);
  v = Signs.carView(Signs.carStatus(car, T('2026-10-31T06:45:00-04:00'), ASPH, NYC), T('2026-10-31T06:45:00-04:00'));
  assert.equal(v.tone, 'red'); assert.equal(v.detail, '15m left');
  // exactly 2h is amber, just over is green
  assert.equal(Signs.carView({ state: 'ok', deadline: T('2026-10-31T07:00:00-04:00'), left: 2 * 3600e3 }).tone, 'amber');
  assert.equal(Signs.carView({ state: 'ok', deadline: T('2026-10-31T07:00:00-04:00'), left: 2 * 3600e3 + 60000 }).tone, 'green');
  // past the deadline: in violation, red, with when it is OK again
  s = Signs.carStatus(car, T('2026-10-31T08:00:00-04:00'), ASPH, NYC);
  assert.equal(s.state, 'violation'); assert.equal(+s.okAt, +T('2026-10-31T19:00:00-04:00'));
  v = Signs.carView(s, T('2026-10-31T08:00:00-04:00'));
  assert.equal(v.tone, 'red'); assert.equal(v.title, 'Move the car now');
  assert.match(v.detail, /7:00 PM today/);
  // once the window is over, it rolls on to the next one (Sunday is free, so Monday 7 AM)
  s = Signs.carStatus(car, T('2026-10-31T20:00:00-04:00'), ASPH, NYC);
  assert.equal(s.state, 'ok'); assert.equal(+s.deadline, +T('2026-11-02T07:00:00-05:00'));
});

test('carStatus across the DST change counts real hours', () => {
  // Parked Sat Oct 31, 10 PM EDT; clocks fall back Sun Nov 1 at 2 AM; next window Mon 8 AM EST.
  const car = carAt('NO PARKING 8AM-6PM MON-FRI', '2026-10-31T22:00:00-04:00');
  const now = T('2026-10-31T22:00:00-04:00');
  const s = Signs.carStatus(car, now, ASPH, NYC);
  assert.equal(+s.deadline, +T('2026-11-02T08:00:00-05:00'));
  assert.equal(s.left, 35 * 3600e3); // 34 wall-clock hours + the extra hour
  assert.equal(Signs.carView(s, now).title, 'Move by 8:00 AM Mon');
  assert.equal(Signs.carView(s, now).detail, '1d 11h left');
});

test('carStatus honours ASP suspensions and says when no move is needed this week', () => {
  const car = carAt('NO PARKING (SANITATION BROOM SYMBOL) 8:30AM-10AM TUESDAY', '2026-11-02T12:00:00-05:00');
  const now = T('2026-11-02T12:00:00-05:00');
  // Tue Nov 3 is Election Day (ASP suspended) -> next cleaning Tue Nov 10, more than 7 days away
  let s = Signs.carStatus(car, now, ASPH, NYC);
  assert.equal(s.state, 'none');
  assert.equal(Signs.carView(s, now).title, 'No move needed this week');
  assert.equal(Signs.carView(s, now).tone, 'green');
  // without the suspension it would be tomorrow morning
  s = Signs.carStatus(car, now, {}, NYC);
  assert.equal(s.state, 'ok'); assert.equal(+s.deadline, +T('2026-11-03T08:30:00-05:00'));
  // a sign with nothing upcoming at all
  s = Signs.carStatus(carAt('NO STANDING 7AM-10AM MON-FRI', '2026-10-30T12:00:00-04:00', { sides: [{ id: 'front', arrow: 'away', rules: NYC.parse('NO STANDING ANYTIME').rules }] }), now, ASPH, NYC);
  assert.equal(s.state, 'unknown');
  assert.equal(Signs.carView(s, now).tone, 'amber');
});

test('carStatus: time limits count from parking time, including ones that start later', () => {
  const car = carAt('2 HOUR PARKING 9AM-7PM EXCEPT SUNDAY', '2026-10-30T10:00:00-04:00');
  let s = Signs.carStatus(car, T('2026-10-30T11:30:00-04:00'), ASPH, NYC);
  assert.equal(s.state, 'ok'); assert.equal(s.timeLimit, true);
  assert.equal(+s.deadline, +T('2026-10-30T12:00:00-04:00')); // not 11:30 + 2h
  assert.equal(Signs.carView(s, T('2026-10-30T11:30:00-04:00')).title, 'Time is up at 12:00 PM Fri');
  s = Signs.carStatus(car, T('2026-10-30T12:30:00-04:00'), ASPH, NYC);
  assert.equal(s.state, 'violation'); assert.equal(Signs.carView(s, T('2026-10-30T12:30:00-04:00')).title, 'Time is up. Move the car');
  // parked overnight before a 2-hour window: must leave 2h after it starts
  const night = carAt('2 HOUR PARKING 9AM-7PM EXCEPT SUNDAY', '2026-10-29T22:00:00-04:00');
  s = Signs.carStatus(night, T('2026-10-29T23:00:00-04:00'), ASPH, NYC);
  assert.equal(+s.deadline, +T('2026-10-30T11:00:00-04:00'));
});

test('car helpers: reminder, walking distance, directions, share text, title', () => {
  const now = T('2026-10-30T22:48:00-04:00'), dl = T('2026-10-31T07:00:00-04:00');
  assert.equal(+Signs.reminderAt(dl, now), +T('2026-10-31T06:30:00-04:00'));
  assert.equal(+Signs.reminderAt(T('2026-10-30T23:00:00-04:00'), now), +now + 60000); // never in the past
  const ics = Signs.icsReminder(dl, now, 'Move your car by 7:00 AM', 'x');
  assert.match(ics, /DTSTART:20261031T103000Z/); assert.match(ics, /BEGIN:VALARM/); assert.match(ics, /TRIGGER:PT0M/);
  const w = Signs.walkInfo({ lat: 40.80954, lon: -73.94702 }, { lat: 40.8139, lon: -73.9441 }); // ~0.34 mi
  assert.equal(w.text, '0.3 mi, about 7 min walk');
  assert.match(Signs.walkInfo({ lat: 40.80954, lon: -73.94702 }, { lat: 40.8100, lon: -73.9470 }).text, /^\d+0 ft, about 1 min walk$/);
  assert.equal(Signs.walkInfo(null, { lat: 1, lon: 1 }), null);
  assert.equal(Signs.walkInfo({ lat: 40.80954, lon: -73.94702 }, { lat: 40.80955, lon: -73.94702 }).text, 'You are right by your car');
  const car = carAt('NO PARKING 7AM-7PM EXCEPT SUNDAY', '2026-10-30T20:15:00-04:00');
  assert.equal(Signs.directionsUrl(car, true), 'https://maps.apple.com/?daddr=40.80954,-73.94702&dirflg=w');
  assert.equal(Signs.directionsUrl(car, false), 'https://www.google.com/maps/dir/?api=1&destination=40.80954,-73.94702&travelmode=walking');
  const noGps = Object.assign({}, car, { lat: null, lon: null });
  assert.equal(Signs.directionsUrl(noGps, true), 'https://maps.apple.com/?daddr=165%20W%20126th%20St,%20Manhattan&dirflg=w');
  assert.match(Signs.directionsUrl(noGps, false), /destination=165%20W%20126th%20St,%20Manhattan&travelmode=walking$/);
  assert.equal(Signs.directionsUrl(Object.assign({}, noGps, { address: '' }), true), null);
  assert.equal(Signs.isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)'), true);
  assert.equal(Signs.isIOS('Mozilla/5.0 (Macintosh)', 'MacIntel', 5), true);
  assert.equal(Signs.isIOS('Mozilla/5.0 (Linux; Android 14)'), false);
  const st = Signs.carStatus(car, now, ASPH, NYC);
  const text = Signs.carShareText(car, st, now);
  assert.equal(text, '🚗 My car is at 165 W 126th St, Manhattan\n⏰ Move by 7:00 AM Sat (8h 12m left)\n🅿️ Parked at 8:15 PM\n📍 https://maps.google.com/?q=40.80954,-73.94702');
  assert.equal(Signs.carDocTitle(Signs.carView(st, now)), '⏱ 8h 12m left · ParkHero');
  assert.equal(Signs.leftText(25 * 3600e3), '1d 1h'); assert.equal(Signs.leftText(59 * 60000), '59m'); assert.equal(Signs.leftText(20000), 'under 1m');
  assert.equal(Signs.pastText(T('2026-10-29T21:00:00-04:00'), now), '9:00 PM yesterday');
});
