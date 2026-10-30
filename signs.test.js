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
