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
