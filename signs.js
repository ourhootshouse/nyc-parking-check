// City-sign text, nearby-sign choice, and share/save helpers (browser + Node).
(function (root) {
  function expandCityDescription(raw) {
    let t = String(raw || '').toUpperCase();
    t = t.replace(/\(SUPERSEDES[^)]*\)/g, ' ');
    t = t.replace(/\(SANITATION BROOM SYMBOL\)/g, ' STREET CLEANING ');
    t = t.replace(/\(BUS\s*&?\s*HANDICAP SYMBOLS\)/g, ' ');
    t = t.replace(/\(FOR FULL TIME BUS STOPS\)/g, ' ');
    let glyph = 'none';
    if (/<[\-]+>/.test(t)) glyph = 'both';
    else if (/--+>|<--+/.test(t)) glyph = 'single';
    t = t.replace(/<[\-]+>|--+>|<--+/g, ' ');
    t = t.replace(/(\d+)\s*HMP\b/g, '$1 HOUR METERED PARKING');
    t = t.replace(/(\d+)\s*HP\b/g, '$1 HOUR PARKING');
    t = t.replace(/\bW\/\b/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return { text: t, glyph };
  }

  function isLocator(desc) {
    return /PAY-BY-CELL|LOCATOR NUMBER|REAL TIME PUBLIC INFORMATION|INFORMATION BOX/i.test(String(desc || ''));
  }

  // State Plane ft: x grows east, y grows north. Arrow compass points toward the pin or away.
  function compassRelative(sign, pin) {
    const compass = sign && sign.compass;
    if (!compass || !pin || sign.x == null || sign.y == null) return null;
    const dx = pin.x - (+sign.x), dy = pin.y - (+sign.y);
    if (dx * dx + dy * dy < 4) return 'both';
    const toward = { East: dx > 0, West: dx < 0, North: dy > 0, South: dy < 0 }[compass];
    if (toward == null) return null;
    return toward ? 'toward' : 'away';
  }

  function signsForSlot(poleSigns, pin) {
    const lines = [];
    let singleToward = false;
    for (const s of poleSigns || []) {
      if (isLocator(s.description)) continue;
      const ex = expandCityDescription(s.description);
      if (!ex.text) continue;
      let rel = 'both';
      if (ex.glyph === 'single') rel = compassRelative(s, pin) || 'toward';
      if (rel === 'away') continue;
      lines.push(ex.text);
      if (ex.glyph === 'single' && rel === 'toward') singleToward = true;
    }
    if (!lines.length) return null;
    return { text: [...new Set(lines)].join('\n\n'), arrow: singleToward ? 'toward' : 'both' };
  }

  function estimatePinDistance(signs, pin) {
    const pts = (signs || []).filter(s => s.x != null && s.y != null && s.dist != null && !isNaN(+s.dist));
    if (pts.length < 2 || !pin) return null;
    const xs = pts.map(p => +p.x), ys = pts.map(p => +p.y);
    const xspan = Math.max(...xs) - Math.min(...xs);
    const yspan = Math.max(...ys) - Math.min(...ys);
    if (xspan < 5 && yspan < 5) return null;
    const useX = xspan >= yspan;
    let n = 0, sC = 0, sD = 0, sCC = 0, sCD = 0;
    for (const p of pts) {
      const c = useX ? +p.x : +p.y;
      const d = +p.dist;
      n++; sC += c; sD += d; sCC += c * c; sCD += c * d;
    }
    const denom = n * sCC - sC * sC;
    if (Math.abs(denom) < 1) return null;
    const b = (n * sCD - sC * sD) / denom;
    const a = (sD - b * sC) / n;
    const c = useX ? +pin.x : +pin.y;
    return a + b * c;
  }

  function groupPoles(signs) {
    const poles = [];
    for (const s of signs || []) {
      if (s.dist == null || isNaN(+s.dist)) continue;
      let pole = poles.find(p => Math.abs(p.dist - (+s.dist)) <= 8);
      if (!pole) { pole = { dist: +s.dist, signs: [] }; poles.push(pole); }
      pole.signs.push(s);
    }
    poles.sort((a, b) => a.dist - b.dist);
    return poles;
  }

  // frontTowardHigherDist: the front of the car points toward the far end of the block
  // (distance_from_intersection increases from the from-street toward the to-street).
  function pickFrontBehind(signs, pinDist, frontTowardHigherDist) {
    const poles = groupPoles((signs || []).filter(s => !isLocator(s.description)));
    if (!poles.length || pinDist == null || isNaN(+pinDist)) return { front: null, behind: null };
    const higher = poles.find(p => p.dist >= pinDist) || poles[poles.length - 1];
    const lower = [...poles].reverse().find(p => p.dist <= pinDist) || poles[0];
    let front = frontTowardHigherDist ? higher : lower;
    let behind = frontTowardHigherDist ? lower : higher;
    if (front && behind && front.dist === behind.dist) behind = null;
    return { front, behind };
  }

  function toB64url(str) {
    const b = typeof Buffer !== 'undefined'
      ? Buffer.from(str, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(str)));
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function fromB64url(s) {
    let b = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const json = typeof Buffer !== 'undefined'
      ? Buffer.from(b, 'base64').toString('utf8')
      : decodeURIComponent(escape(atob(b)));
    return JSON.parse(json);
  }
  function encodeState(state) { return toB64url(JSON.stringify(state)); }
  function decodeState(s) { return fromB64url(s); }

  // ---- v2 share links: "#s=FRONT;BEHIND;FLAGS;LAT;LON" ----
  // Readable and short. Spaces become "+", line breaks become "/", and
  // fields are percent-encoded, so a raw ";" or "/" never appears inside a field.
  // FLAGS: A/B = front sign points away/both ways, a/b = same for the sign
  // behind, c = commercial plates. Defaults (toward, not commercial) are left out,
  // as are empty trailing fields. Lat/lon are rounded to 5 decimals (about 1 m).
  const ARROW_CODE = { away: 'a', both: 'b' };
  const CODE_ARROW = { a: 'away', b: 'both' };
  function encField(s) {
    return String(s || '').replace(/\r/g, '').split('\n')
      .map(line => encodeURIComponent(line.replace(/[ \t]+/g, ' ')).replace(/%20/g, '+'))
      .join('/');
  }
  function decField(s) {
    return String(s || '').split('/')
      .map(part => decodeURIComponent(part.replace(/\+/g, ' ')))
      .join('\n');
  }
  function round5(n) { return Number(Number(n).toFixed(5)); }
  function encodeStateV2(state) {
    const st = state || {};
    let flags = '';
    if (ARROW_CODE[st.frontArrow]) flags += ARROW_CODE[st.frontArrow].toUpperCase();
    if (ARROW_CODE[st.behindArrow]) flags += ARROW_CODE[st.behindArrow];
    if (st.commercial) flags += 'c';
    const hasLoc = st.lat != null && st.lon != null && st.lat !== '' && isFinite(st.lat) && isFinite(st.lon);
    const f = [encField(st.front), encField(st.behind), flags,
      hasLoc ? String(round5(st.lat)) : '', hasLoc ? String(round5(st.lon)) : ''];
    while (f.length && f[f.length - 1] === '') f.pop();
    return f.join(';');
  }
  function decodeStateV2(s) {
    let raw = String(s || '');
    // Some apps percent-encode the whole fragment; undo that once.
    if (raw.indexOf(';') < 0 && /%3B/i.test(raw)) raw = decodeURIComponent(raw);
    const f = raw.split(';');
    const flags = f[2] || '';
    const up = (flags.match(/[AB]/) || [''])[0].toLowerCase();
    const lo = (flags.match(/[ab]/) || [''])[0];
    const out = {
      v: 2,
      front: decField(f[0]),
      frontArrow: CODE_ARROW[up] || 'toward',
      behind: decField(f[1]),
      behindArrow: CODE_ARROW[lo] || 'toward',
      commercial: flags.indexOf('c') >= 0
    };
    if (f[3] && f[4] && isFinite(f[3]) && isFinite(f[4])) { out.lat = Number(f[3]); out.lon = Number(f[4]); }
    return out;
  }
  // Hash fragment for a share link (always v2).
  function shareHash(state) { return 's=' + encodeStateV2(state); }
  // Read state from a location.hash. Understands v2 (#s=) and old v1 (#p=) links.
  function stateFromHash(hash) {
    const h = String(hash || '');
    const m2 = h.match(/(?:^#?|[&#])s=([^&]*)/);
    if (m2) return decodeStateV2(m2[1]);
    const m1 = h.match(/(?:^#?|[&#])p=([^&]+)/);
    if (m1) return decodeState(decodeURIComponent(m1[1]));
    return null;
  }

  // ---- friendly share text ----
  const TZ = 'America/New_York';
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function nyDay(d) {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(d))) p[x.type] = x.value;
    return { key: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour) % 24, wd: WD.indexOf(p.weekday), utcDay: Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5 };
  }
  function timeText(d) {
    return new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  }
  // "7:00 PM today", "11:00 PM tonight", "7:00 AM tomorrow (Fri)", "8:00 AM on Tuesday", "9:00 AM on Mon, Nov 9"
  function whenText(d, now) {
    const a = nyDay(d), b = nyDay(now || new Date());
    const diff = a.utcDay - b.utcDay;
    const t = timeText(d);
    if (diff <= 0) return t + (a.hour >= 20 ? ' tonight' : ' today');
    if (diff === 1) return t + ' tomorrow (' + WD[a.wd] + ')';
    if (diff < 7) return t + ' on ' + WDL[a.wd];
    return t + ' on ' + new Date(d).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  }
  function minsText(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' hr' + (r ? ' ' + r + ' min' : '');
  }
  function clock(m) {
    m = ((m % 1440) + 1440) % 1440;
    if (m === 0) return 'midnight';
    if (m === 720) return 'noon';
    const h = Math.floor(m / 60), mi = m % 60;
    return (h % 12 || 12) + (mi ? ':' + String(mi).padStart(2, '0') : '') + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function daysText(days) {
    const ds = Array.from(new Set(days || [])).sort((x, y) => x - y);
    if (!ds.length || ds.length === 7) return '';
    const key = ds.join('');
    if (key === '12345') return 'Mon–Fri';
    if (key === '123456') return 'Mon–Sat';
    if (key === '06') return 'weekends';
    if (ds.length === 6) return 'except ' + WD[[0, 1, 2, 3, 4, 5, 6].find(x => ds.indexOf(x) < 0)];
    const names = ds.map(x => WD[x]);
    return names.length === 1 ? names[0] + 's' : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }
  function hoursText(min) {
    const h = min / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + '-hour';
  }
  // Plain-English one-liner for a parsed rule (from NYCRules.parse).
  function friendlyRule(r) {
    if (!r) return '';
    let base;
    switch (r.type) {
      case 'NO_STOPPING': base = 'No stopping'; break;
      case 'NO_STANDING': base = 'No standing'; break;
      case 'COMMERCIAL_ONLY': base = 'Commercial vehicles only'; break;
      case 'TIME_LIMIT': base = hoursText(r.limitMin) + (r.metered ? ' metered' : '') + ' parking' + (r.commercialOnly ? ' (commercial vehicles only)' : ''); break;
      default: base = r.streetCleaning ? 'Street cleaning, no parking' : 'No parking';
    }
    const allDay = r.anytime || !(r.times || []).length || (r.times || []).every(([a, b]) => a === 0 && b === 1440);
    const times = allDay ? '' : r.times.map(([a, b]) => clock(a) + ' to ' + clock(b)).join(' & ');
    const days = daysText(r.days);
    if (allDay && !days) return base + (r.type === 'TIME_LIMIT' ? ' all day' : ' anytime');
    return base + (times ? ' ' + times : ' all day') + (days ? ', ' + days : '');
  }
  // Summarize the signs that applied. Only name front/behind when both signs count.
  function signSummary(rules) {
    const bySide = {};
    for (const r of rules || []) {
      const side = r.side === 'behind' ? 'behind' : 'front';
      const t = friendlyRule(r);
      if (!t) continue;
      (bySide[side] = bySide[side] || []);
      if (bySide[side].indexOf(t) < 0) bySide[side].push(t);
    }
    const sides = Object.keys(bySide);
    if (!sides.length) return '';
    if (sides.length === 1) return bySide[sides[0]].join('. ') + '.';
    const f = bySide.front.join('. '), b = bySide.behind.join('. ');
    if (f === b) return f + '.';
    return 'Front sign: ' + f + '.\n' + 'Back sign: ' + b + '.';
  }
  const BOROUGHS = ['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'];
  const ABBR = { street: 'St', avenue: 'Ave', west: 'W', east: 'E', north: 'N', south: 'S', boulevard: 'Blvd', place: 'Pl', road: 'Rd', drive: 'Dr', parkway: 'Pkwy', lane: 'Ln', court: 'Ct', square: 'Sq', terrace: 'Ter', highway: 'Hwy', expressway: 'Expy' };
  const ORD_AFTER = /^(St|Ave|Pl|Rd|Dr|Ter|Ct|Ln)$/;
  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }
  // "165 WEST 126 STREET, Manhattan, New York, NY, USA" -> "165 W 126th St, Manhattan"
  function tidyAddress(label) {
    if (!label) return '';
    const parts = String(label).split(',').map(s => s.trim()).filter(Boolean)
      .filter(p => !/^(USA|United States|US)$/i.test(p));
    if (!parts.length) return '';
    let borough = '';
    for (const p of parts) {
      const hit = BOROUGHS.find(b => b.toLowerCase() === p.toLowerCase().replace(/^the\s+/, ''));
      if (hit) { borough = hit; break; }
    }
    const words = parts[0].split(/\s+/).map(w => {
      const lw = w.toLowerCase();
      if (ABBR[lw]) return ABBR[lw];
      if (/^\d/.test(w)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    });
    for (let i = 1; i < words.length; i++) {
      if (/^\d+$/.test(words[i]) && words[i + 1] && ORD_AFTER.test(words[i + 1])) words[i] = ordinal(Number(words[i]));
    }
    const street = words.join(' ');
    if (BOROUGHS.some(b => b.toLowerCase() === street.toLowerCase())) return street;
    return street + ', ' + (borough || 'NYC');
  }
  // True when any applied rule depends on commercial vs passenger plates.
  function vehicleMatters(rules) {
    return (rules || []).some(r => r && !r.badWindow && (r.type === 'COMMERCIAL_ONLY' || r.commercialOnly));
  }
  // Friendly, scannable share text. info:
  //  canPark, when (Date: move-by or OK-at), isTimeLimit, now, rules (applied parsed rules with .side),
  //  address (raw label), commercial, url, linkInText (default false: Web Share passes url separately)
  function shareText(info) {
    const i = info || {};
    const now = i.now ? new Date(i.now) : new Date();
    const lines = [];
    if (i.canPark) {
      if (i.when) {
        const ms = new Date(i.when) - now;
        const w = whenText(i.when, now);
        if (ms < 3600e3) lines.push('⚠️ You can park here, but move by ' + w + ' (' + minsText(ms) + ' left)');
        else if (i.isTimeLimit) lines.push('✅ You can park here until ' + w + ' (time limit)');
        else lines.push('✅ You can park here until ' + w);
      } else {
        lines.push('✅ You can park here. Nothing kicks in for the next 2 weeks.');
      }
    } else {
      lines.push(i.when ? '🚫 No parking here right now. OK after ' + whenText(i.when, now) + '.' : '🚫 No parking here at any time.');
    }
    const addr = tidyAddress(i.address);
    if (addr) lines.push('📍 ' + addr);
    let detail = signSummary(i.rules);
    // Only mention vehicle type when a sign that applied treats commercial plates differently.
    if (vehicleMatters(i.rules)) detail = (detail ? detail + ' ' : '') + (i.commercial ? '(For commercial plates.)' : '(For a passenger car.)');
    if (detail) lines.push(detail);
    if (i.outsideNYC) lines.unshift('⚠️ ' + NYC_RULES_WARNING + ' (this spot looks to be outside New York City).');
    let out = lines.join('\n');
    if (i.url && i.linkInText) out += '\n\nCheck it in ParkHero: ' + i.url;
    return out;
  }

  // ---- Is this spot in New York City? ----
  // Five-borough boundary, water areas included, so piers, bridges and the rivers out to the state line count.
  // Source: NYC DCP "Borough Boundaries (water areas included)" (NYC Open Data wh2p-dxnf), simplified to about 40 m.
  // Each ring is lon,lat x 1e4: the first point, then deltas.
  const NYC_AREA = {
    'Staten Island': ['-740558,406497,-8,-224,152,-242,69,-268,-19,-253,-58,-417,-565,-103,-1294,-216,-252,100,-54,96,7,108,-5,3,37,72,87,57,-41,186,-4,23,32,73,157,93,133,-15,31,32,63,164,18,113,77,96,1,27,-44,58,7,81,12,45,-18,56,15,67,50,48,10,20,106,83,40,5,385,-45,102,17,73,3,156,40,163,2,69,34,310,3'],
    'Brooklyn': ['-739272,407253,45,-88,-16,-9,3,-16,18,-11,15,-24,-12,-11,101,-60,-11,-10,22,-14,-11,-11,75,-42,-15,-16,44,-25,-5,-5,15,-29,-8,-3,47,-56,23,30,16,-18,24,15,6,-8,51,25,50,44,55,31,51,9,5,-4,24,-128,19,5,8,-33,10,1,19,-79,28,4,19,-78,-27,-4,8,-34,-56,-18,71,-91,11,-61,67,4,153,-152,-15,-211,-154,-185,-36,-21,-257,-119,-113,-20,-134,-11,-1325,-206,19,253,-69,268,-152,242,8,246,70,97,142,233,153,-53,113,67,21,-1,25,34,4,8,20,-3,-10,17,10,23,63,93,-1,8,21,13,61,-5,32,6,25,-2,0,5,16,-1,38,17,27,19,25,-21,7,3,-3,37,6,-2,8,17,12,42,22,22,-1,11,7,-3,15,20,13,29,7,38,-15,81,54,24,20,2,25,-2,58,-18,46,-17,25,-42,22,-17,83,-20'],
    'Queens': ['-737790,408117,153,-179,66,-41,63,-68,492,-304,16,-132,-77,-115,-92,-14,-134,-42,34,-122,13,-304,-20,-54,-7,-112,27,-63,4,-47,-53,-17,-46,-6,-63,-28,-7,-54,7,-10,-9,-4,28,-44,-5,-6,-27,-1,15,26,-21,4,-27,-28,-215,-86,-13,-23,12,-28,9,-65,15,-1,52,-36,53,-9,67,19,11,-7,11,4,24,-45,50,-44,0,-72,10,-28,-71,-2,-33,-14,-74,-59,-29,-301,-107,-217,-150,-13,-419,-94,-289,-110,-150,-93,-71,-16,-99,-114,-633,357,-923,-162,58,417,1325,206,134,11,113,20,293,140,154,185,9,167,6,44,-153,152,-67,-4,-11,61,-71,91,56,18,-8,34,27,4,-19,78,-28,-4,-19,79,-10,-1,-8,33,-19,-5,-24,128,-5,4,-51,-9,-55,-31,-50,-44,-51,-25,-6,8,-24,-15,-16,18,-23,-30,-47,56,8,3,-15,29,5,5,-44,25,15,16,-75,42,11,11,-22,14,11,10,-101,60,12,11,-15,24,-18,11,-3,16,16,9,-51,100,-13,12,-84,21,-22,17,-25,42,-46,17,-58,18,-25,2,-20,-2,-54,-24,-1,22,14,14,-7,4,5,20,44,61,57,57,100,123,60,36,3,12,-25,8,-3,11,14,33,26,12,20,-2,19,-17,13,4,114,76,46,52,24,11,-5,26,-17,30,216,-59,25,-32,100,-16,48,4,27,21,6,30,72,68,99,24,177,21,180,36,61,-4,176,-50,58,0,32,22'],
    'Manhattan': ['-740439,406902,4,-5,9,3,-18,-15,-24,15,-7,-4,3,11,12,4', '-740400,407009,23,-16,-5,-9,-11,-3,-19,14,-5,-4,18,-14,-18,-12,-20,15', '-739259,408793,32,-4,29,-25,20,-7,20,0,43,33,12,0,33,-21,3,-11,-10,-30,-12,-6,-10,-43,-111,-126,-58,-80,-62,-116,-6,-29,12,-132,-5,-95,6,-17,36,-43,14,-6,-3,-8,47,-3,27,-28,78,-35,17,-30,5,-26,-24,-11,-46,-52,-114,-76,-13,-4,-19,17,-20,2,-26,-12,-14,-33,3,-11,25,-8,-3,-12,-60,-36,-100,-123,-57,-57,-46,-70,-3,-11,7,-4,-14,-14,3,-59,13,-44,-7,-38,-13,-29,-15,-20,-7,3,1,-11,-22,-22,-12,-42,-8,-17,-6,2,3,-37,-7,-3,-25,21,-27,-19,-38,-17,-16,1,0,-5,-25,2,-32,-6,-61,5,-21,-13,1,-8,-63,-93,-10,-23,10,-17,-20,3,-29,-42,-21,1,-113,-67,-153,53,84,149,47,278,75,293,507,702,104,250,191,302'],
    'Bronx': ['-738648,409020,53,-15,6,12,-7,7,14,-1,11,13,-1,17,12,0,-8,9,26,8,5,8,-10,2,1,9,16,15,7,-5,12,5,-24,-29,26,-9,7,9,54,-20,-1,-13,35,0,22,-48,-4,-21,12,-32,159,-47,-9,5,5,13,450,-121,327,-76,-92,-149,-207,-257,-39,-192,-57,-91,-32,-22,-58,0,-176,50,-61,4,-180,-36,-177,-21,-99,-24,-72,-68,-6,-30,-26,-21,-49,-4,-100,16,-20,29,-18,4,-203,58,-78,35,-27,28,-47,3,0,13,-11,1,-38,47,1,108,-12,132,6,29,62,116,58,80,111,126,10,43,12,6,10,30,-3,11,-33,21,-12,0,-43,-33,-20,0,-20,7,-30,25,-21,0,-89,34,43,74,112,280']
  };
  const NYC_BOX = { s: 40.476, n: 40.918, w: -74.26, e: -73.70 };
  let nycRings = null;
  function nycAreaRings() {
    if (nycRings) return nycRings;
    nycRings = [];
    for (const name of Object.keys(NYC_AREA)) for (const s of NYC_AREA[name]) {
      const n = s.split(',').map(Number), ring = [];
      let x = n[0], y = n[1]; ring.push([x / 1e4, y / 1e4]);
      for (let i = 2; i < n.length; i += 2) { x += n[i]; y += n[i + 1]; ring.push([x / 1e4, y / 1e4]); }
      nycRings.push({ name, ring });
    }
    return nycRings;
  }
  function inRing(lon, lat, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[j];
      if ((y1 > lat) !== (y2 > lat) && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) c = !c;
    }
    return c;
  }
  // Borough name for a point, or null when it is outside the five boroughs.
  function nycBorough(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (lat < NYC_BOX.s || lat > NYC_BOX.n || lon < NYC_BOX.w || lon > NYC_BOX.e) return null;
    for (const r of nycAreaRings()) if (inRing(lon, lat, r.ring)) return r.name;
    return null;
  }
  // 'nyc' | 'outside' | 'unknown' (no coordinates: still allowed, with an "NYC rules only" note)
  function nycScope(lat, lon) {
    if (lat == null || lon == null || lat === '' || lon === '' || !isFinite(lat) || !isFinite(lon)) return 'unknown';
    return nycBorough(lat, lon) ? 'nyc' : 'outside';
  }
  const US_STATES = { AL: 1, AK: 1, AZ: 1, AR: 1, CA: 1, CO: 1, CT: 1, DE: 1, DC: 1, FL: 1, GA: 1, HI: 1, ID: 1, IL: 1, IN: 1, IA: 1, KS: 1, KY: 1, LA: 1, ME: 1, MD: 1, MA: 1, MI: 1, MN: 1, MS: 1, MO: 1, MT: 1, NE: 1, NV: 1, NH: 1, NJ: 1, NM: 1, NY: 1, NC: 1, ND: 1, OH: 1, OK: 1, OR: 1, PA: 1, RI: 1, SC: 1, SD: 1, TN: 1, TX: 1, UT: 1, VT: 1, VA: 1, WA: 1, WV: 1, WI: 1, WY: 1, PR: 1 };
  // "Washington, DC", "Jersey City, NJ", "Toronto, Canada" from a Nominatim reverse result; null if nothing usable.
  function placeNameFrom(j) {
    const a = j && j.address; if (!a) return null;
    const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '';
    const iso = String(a['ISO3166-2-lvl4'] || '');
    let region = '';
    if (a.country_code === 'us') { const st = iso.replace(/^US-/, ''); region = US_STATES[st] ? st : (a.state || ''); }
    else region = a.country || a.state || '';
    const name = [town, region].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(', ');
    return name ? name.slice(0, 60) : null;
  }
  // The neutral card shown instead of a verdict outside the five boroughs.
  function outsideText(name) {
    return {
      title: 'ParkHero only covers New York City',
      line: (name ? 'You look to be in ' + name + '. ' : 'You look to be outside NYC. ') + 'Rules here differ, so check the posted signs and local rules.'
    };
  }
  const NYC_RULES_WARNING = 'NYC rules, may not apply here';

  // ---- garage referral links (SpotHero / ParkWhiz) ----
  // Wall-clock parts of a Date in New York, plus that moment's UTC offset in minutes.
  function nyWall(d) {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d))) p[x.type] = x.value;
    const y = +p.year, mo = +p.month, da = +p.day, h = (+p.hour) % 24, mi = +p.minute, s = +p.second;
    const asUtc = Date.UTC(y, mo - 1, da, h, mi, s);
    const offset = Math.round((asUtc - Math.floor(new Date(d).getTime() / 1000) * 1000) / 60000);
    return { y, mo, da, h, mi, offset };
  }
  const p2 = n => String(n).padStart(2, '0');
  // "2026-10-30T10:15" in New York local time (SpotHero's own search links use this form).
  function nyLocalMinute(d) {
    const w = nyWall(d);
    return w.y + '-' + p2(w.mo) + '-' + p2(w.da) + 'T' + p2(w.h) + ':' + p2(w.mi);
  }
  // "2026-10-30T10:15:00-04:00" (ParkWhiz wants an explicit offset).
  function nyIsoOffset(d) {
    const w = nyWall(d), o = w.offset, sign = o < 0 ? '-' : '+', a = Math.abs(o);
    return nyLocalMinute(d) + ':00' + sign + p2(Math.floor(a / 60)) + ':' + p2(a % 60);
  }
  // Booking window: from now until street parking is legal again.
  // Falls back to now + 2h when that time is unknown, already past, or more than 24h away.
  // Never shorter than 1 hour, and the end is rounded up to the next 15 minutes.
  function garageWindow(now, legalAt) {
    const start = new Date(Math.floor(new Date(now).getTime() / 60000) * 60000);
    const H = 3600e3;
    let end, known = false;
    const t = legalAt ? new Date(legalAt).getTime() : NaN;
    if (isFinite(t) && t > start.getTime() && t - start.getTime() <= 24 * H) { end = t; known = true; }
    else end = start.getTime() + 2 * H;
    if (end - start.getTime() < H) end = start.getTime() + H;
    const q = 15 * 60000;
    end = Math.ceil(end / q) * q;
    return { start, end: new Date(end), known };
  }
  function slugTitle(address) {
    const street = String(tidyAddress(address) || '').split(',')[0];
    const words = street.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
      .map(w => /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));
    return words.length ? 'Parking-Near-' + words.join('-') : 'NYC-Parking';
  }
  // Wrap a SpotHero URL with an affiliate id/link when one is configured.
  //  - plain id (e.g. "1234"): SpotHero's HasOffers affiliate link via its Branch deep link (format seen on partner sites)
  //  - full tracking-link prefix (starts with http, e.g. an impact.com link ending in "?u=" or similar): destination is appended URL-encoded
  function spotHeroAffiliate(url, aff) {
    aff = String(aff || '').trim();
    if (!aff) return url;
    if (/^https?:\/\//i.test(aff)) return aff + encodeURIComponent(url);
    const tracking = 'http://tracking.spothero.com/aff_c?offer_id=1&aff_id=' + encodeURIComponent(aff) + '&source=parkhero&format=json';
    return 'https://spothero.app.link/ts1p2NqSe1?%243p=a_hasoffers&%24affiliate_json=' + encodeURIComponent(tracking) + '&' + url.split('?')[1];
  }
  // Build both partner search links. info: { lat, lon, address, now, legalAt, affiliate:{spothero, parkwhiz} }
  const NYC_CENTER = { lat: 40.758, lon: -73.9855 };
  function garageLinks(info) {
    const i = info || {};
    // No coordinates (typed or photographed sign, GPS off): fall back to a New York search.
    // SpotHero geocodes search_string on its own; ParkWhiz needs a point, so it gets Midtown (Times Square).
    const generic = i.lat == null || i.lon == null || i.lat === '' || i.lon === '' || !isFinite(i.lat) || !isFinite(i.lon);
    if (generic && i.fallback === false) return null;
    const lat = generic ? NYC_CENTER.lat : round5(i.lat), lon = generic ? NYC_CENTER.lon : round5(i.lon);
    const win = garageWindow(i.now || new Date(), i.legalAt);
    const aff = i.affiliate || {};
    const addr = tidyAddress(i.address);
    const sh = new URLSearchParams();
    sh.set('kind', 'address');
    if (!generic) { sh.set('latitude', String(lat)); sh.set('longitude', String(lon)); }
    if (addr) sh.set('search_string', addr.replace(/, NYC$/, ', New York') + ', NY');
    else if (i.area && !generic) sh.set('search_string', String(i.area));
    else if (generic) sh.set('search_string', 'New York, NY');
    sh.set('starts', nyLocalMinute(win.start));
    sh.set('ends', nyLocalMinute(win.end));
    const spothero = spotHeroAffiliate('https://spothero.com/search?' + sh.toString(), aff.spothero);
    const pw = new URLSearchParams();
    pw.set('lat', String(lat));
    pw.set('lng', String(lon));
    pw.set('start', nyIsoOffset(win.start));
    pw.set('end', nyIsoOffset(win.end));
    if (String(aff.parkwhiz || '').trim()) pw.set('pwa', String(aff.parkwhiz).trim());
    const parkwhiz = 'https://www.parkwhiz.com/destination/' + (generic ? 'New-York-NY' : !addr && i.area ? (String(i.area).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Parking') : slugTitle(i.address)) + '/?' + pw.toString();
    return { spothero, parkwhiz, generic, start: win.start, end: win.end, endKnown: win.known, legalAt: win.known ? new Date(i.legalAt) : null };
  }

  // Which garage card to show for a result, and how long to book.
  //  blocked: can't park now  -> expanded, book until street parking is legal again (okAt)
  //  soon:    can park, window ends within 2h -> expanded, book until it is legal again after that window (afterOkAt)
  //  later:   can park for more than 2h (or no end) -> collapsed row, book until the next violation starts
  function garagePlan(info) {
    const i = info || {};
    const now = new Date(i.now || Date.now());
    const nv = i.nextViolation ? new Date(i.nextViolation) : null;
    if (!i.canPark) return { mode: 'blocked', expanded: true, until: i.okAt ? new Date(i.okAt) : null };
    if (nv && nv - now <= 2 * 3600e3) return { mode: 'soon', expanded: true, until: i.afterOkAt ? new Date(i.afterOkAt) : null };
    return { mode: 'later', expanded: false, until: nv };
  }
  // Theme preference ('auto' | 'light' | 'dark') -> the mode to paint and the browser bar colour.
  const THEME_COLORS = { light: '#f2f3f7', dark: '#000000' };
  function themeFor(pref, systemDark) {
    pref = pref === 'light' || pref === 'dark' ? pref : 'auto';
    const mode = pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref;
    return { pref, mode, color: THEME_COLORS[mode] };
  }

  function shareSummary(info) {
    const lines = ['ParkHero — NYC parking sign checker'];
    if (info.verdictLine) lines.push(info.verdictLine);
    if (info.whenLine) lines.push(info.whenLine);
    if (info.address) lines.push(info.address);
    if (info.front) lines.push('In front (' + (info.frontArrow || 'toward') + '): ' + info.front);
    if (info.behind) lines.push('Behind (' + (info.behindArrow || 'toward') + '): ' + info.behind);
    if (info.commercial) lines.push('Commercial plates');
    if (info.url) lines.push(info.url);
    return lines.join('\n');
  }

  function icsStamp(d) {
    return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }
  function icsEvent(start, title, description) {
    const begin = new Date(start);
    const end = new Date(begin.getTime() + 15 * 60000);
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ParkHero//EN',
      'BEGIN:VEVENT',
      'DTSTART:' + icsStamp(begin),
      'DTEND:' + icsStamp(end),
      'SUMMARY:' + icsEscape(title),
      'DESCRIPTION:' + icsEscape(description),
      'END:VEVENT',
      'END:VCALENDAR',
      ''
    ].join('\r\n');
  }

  // ---- "I parked here": the active car, its countdown, and finding it again ----
  // car: { v:1, parkedAt:ISO, lat, lon, acc, address, sides:[{id, arrow, rules}], commercial, verdict }
  function makeCar(info) {
    const i = info || {};
    const num = x => (x === null || x === undefined || x === '' || !isFinite(x)) ? null : Number(x);
    const sides = (i.sides || []).map(s => ({ id: s.id || null, arrow: s.arrow || 'toward', rules: JSON.parse(JSON.stringify(s.rules || [])) }));
    return {
      v: 1, id: String(i.id || new Date(i.parkedAt || Date.now()).getTime()),
      parkedAt: new Date(i.parkedAt || Date.now()).toISOString(),
      lat: num(i.lat), lon: num(i.lon), acc: num(i.acc), address: String(i.address || ''),
      sides, commercial: !!i.commercial, verdict: String(i.verdict || ''), outside: !!i.outside
    };
  }
  // Outside NYC the saved "address" is just a place name ("Washington, DC"); don't NYC-ify it.
  function carPlace(car) { return car && car.address ? (car.outside ? String(car.address) : tidyAddress(car.address)) : ''; }
  function carHasRules(car) { return !!(car && (car.sides || []).some(s => s.arrow !== 'away' && (s.rules || []).length)); }
  // Where the car stands at `now`. Walks forward from the moment it was parked, so a time limit counts from parking time
  // and a window that already came and went is accounted for. engine = NYCRules.
  //  {state:'ok', deadline, left, timeLimit}  - legal now; must move by deadline
  //  {state:'none'}                          - nothing within 7 days
  //  {state:'violation', since, okAt}        - not allowed right now
  //  {state:'unknown'}                       - no sign rules saved
  function carStatus(car, now, holidays, engine) {
    now = new Date(now || Date.now());
    if (!carHasRules(car)) return { state: 'unknown' };
    const opts = { commercial: !!car.commercial }, H = holidays || {};
    const ev = t => engine.evaluateSides(car.sides, new Date(t), H, opts);
    let t = new Date(Math.min(new Date(car.parkedAt).getTime(), now.getTime()));
    for (let guard = 0; guard < 60; guard++) {
      const r = ev(t);
      if (!r.canPark) {
        if (r.okAt && r.okAt <= now) { t = new Date(r.okAt); continue; }
        return { state: 'violation', since: t > new Date(car.parkedAt) ? t : null, okAt: r.okAt || null, rules: r.blockedBy || [] };
      }
      let deadline = r.nextViolation ? new Date(r.nextViolation) : null, timeLimit = !!r.violationIsTimeLimit;
      // A time limit that starts later (e.g. 2-hour parking from 8 AM) also ends the stay.
      if (!timeLimit && r.upcomingLimit && (!deadline || r.upcomingLimit.start < deadline)) {
        const rl = ev(r.upcomingLimit.start);
        if (rl.canPark && rl.violationIsTimeLimit && rl.nextViolation && (!deadline || rl.nextViolation < deadline)) { deadline = new Date(rl.nextViolation); timeLimit = true; }
      }
      if (!deadline) return { state: 'none' };
      if (deadline > now) {
        if (deadline - now > 7 * 864e5) return { state: 'none', deadline };
        return { state: 'ok', deadline, left: deadline - now, timeLimit, rules: r.nextRules || [] };
      }
      if (timeLimit) return { state: 'violation', since: deadline, okAt: null, timeLimit: true };
      t = deadline;
    }
    return { state: 'unknown' };
  }
  function leftText(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    if (m < 1) return 'under 1m';
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
    if (d) return d + 'd' + (h ? ' ' + h + 'h' : '');
    if (h) return h + 'h' + (mi ? ' ' + mi + 'm' : '');
    return mi + 'm';
  }
  // "7:00 AM Fri"
  function moveByText(d) { return timeText(d) + ' ' + WD[nyDay(d).wd]; }
  // A time in the past: "7:00 AM" today, "7:00 AM yesterday", or "7:00 AM Mon"
  function pastText(d, now) {
    const diff = nyDay(now || new Date()).utcDay - nyDay(d).utcDay;
    return timeText(d) + (diff <= 0 ? '' : diff === 1 ? ' yesterday' : ' ' + WD[nyDay(d).wd]);
  }
  // What the Your car card says. tone: green > 2h left, amber under 2h, red under 30m or in violation.
  function carView(status, now) {
    now = new Date(now || Date.now());
    const s = status || { state: 'unknown' };
    if (s.state === 'ok') {
      const tone = s.left < 30 * 60000 ? 'red' : s.left <= 2 * 3600e3 ? 'amber' : 'green';
      const lt = leftText(s.left);
      return { tone, title: (s.timeLimit ? 'Time is up at ' : 'Move by ') + moveByText(s.deadline), detail: lt + ' left', short: lt + ' left', soon: s.left <= 2 * 3600e3 };
    }
    if (s.state === 'none') return { tone: 'green', title: 'No move needed this week', detail: 'Nothing on these signs for the next 7 days.', short: 'OK this week', soon: false };
    if (s.state === 'violation') {
      const title = s.timeLimit ? 'Time is up. Move the car' : 'Move the car now';
      const detail = s.okAt ? 'Parking here is not allowed until ' + whenText(s.okAt, now) + '.' : s.since ? 'Not allowed here since ' + pastText(s.since, now) + '.' : 'Parking here is not allowed right now.';
      return { tone: 'red', title, detail, short: 'Move now', soon: true };
    }
    return { tone: 'amber', title: 'Check the signs before you leave it', detail: 'No sign rules were saved with this spot.', short: '', soon: false };
  }
  // Reminder time for the .ics: 30 minutes before the deadline, but never in the past.
  function reminderAt(deadline, now) {
    const n = new Date(now || Date.now()).getTime(), d = new Date(deadline).getTime();
    return new Date(Math.max(d - 30 * 60000, n + 60000));
  }
  function icsReminder(deadline, now, title, description) {
    const start = reminderAt(deadline, now);
    const end = new Date(Math.max(new Date(deadline).getTime(), start.getTime() + 15 * 60000));
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ParkHero//EN', 'BEGIN:VEVENT',
      'UID:parkhero-' + start.getTime() + '@parkhero', 'DTSTAMP:' + icsStamp(now || new Date()),
      'DTSTART:' + icsStamp(start), 'DTEND:' + icsStamp(end),
      'SUMMARY:' + icsEscape(title), 'DESCRIPTION:' + icsEscape(description),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(title), 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  }
  // Walking distance (straight line) and a rough time at 3 mph.
  function walkInfo(a, b) {
    if (!a || !b || [a.lat, a.lon, b.lat, b.lon].some(x => x == null || !isFinite(x))) return null;
    const R = 6371008.8, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    const meters = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    const miles = meters / 1609.344, mins = Math.max(1, Math.round(miles * 20));
    const dist = miles < 0.1 ? Math.round(meters * 3.28084 / 10) * 10 + ' ft' : (miles < 10 ? miles.toFixed(1) : Math.round(miles)) + ' mi';
    if (meters < 15) return { meters, miles, mins: 0, text: 'You are right by your car' };
    return { meters, miles, mins, text: dist + ', about ' + mins + ' min walk' };
  }
  function isIOS(ua, platform, touchPoints) {
    ua = String(ua || '');
    return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  }
  // Walking directions: Apple Maps on iOS, Google Maps elsewhere. Falls back to the address when there are no coordinates.
  function directionsUrl(car, ios) {
    const has = car && car.lat != null && car.lon != null && isFinite(car.lat) && isFinite(car.lon);
    const addr = car && car.address ? carPlace(car).replace(/, NYC$/, ', New York, NY') : '';
    if (!has && !addr) return null;
    const dest = has ? round5(car.lat) + ',' + round5(car.lon) : addr;
    return ios ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(dest).replace(/%2C/g, ',') + '&dirflg=w'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest).replace(/%2C/g, ',') + '&travelmode=walking';
  }
  function carMapLink(car) {
    const has = car && car.lat != null && car.lon != null && isFinite(car.lat) && isFinite(car.lon);
    if (has) return 'https://maps.google.com/?q=' + round5(car.lat) + ',' + round5(car.lon);
    return car && car.address ? 'https://maps.google.com/?q=' + encodeURIComponent(carPlace(car)) : null;
  }
  function carShareText(car, status, now) {
    const v = carView(status, now);
    const where = car && car.address ? carPlace(car) : '';
    const lines = ['🚗 My car' + (where ? ' is at ' + where : '')];
    if (car && car.outside) lines.push('⚠️ ' + NYC_RULES_WARNING + ' (outside New York City)');
    if (status && status.state === 'ok') lines.push('⏰ ' + v.title + ' (' + v.detail + ')');
    else lines.push('⏰ ' + v.title);
    lines.push('🅿️ Parked at ' + pastText(car.parkedAt, now));
    const link = carMapLink(car); if (link) lines.push('📍 ' + link);
    return lines.join('\n');
  }
  function carDocTitle(view) { return view && view.short ? '⏱ ' + view.short + ' · ParkHero' : 'ParkHero · NYC parking sign checker'; }

  const api = {
    expandCityDescription, isLocator, compassRelative, signsForSlot,
    estimatePinDistance, groupPoles, pickFrontBehind,
    encodeState, decodeState, encodeStateV2, decodeStateV2, shareHash, stateFromHash,
    whenText, vehicleMatters, friendlyRule, signSummary, tidyAddress, shareText, garageWindow, garageLinks, garagePlan, themeFor, nyLocalMinute, nyIsoOffset, shareSummary, icsEvent,
    nycBorough, nycScope, placeNameFrom, outsideText, NYC_RULES_WARNING,
    makeCar, carPlace, carHasRules, carStatus, carView, leftText, moveByText, pastText, reminderAt, icsReminder, walkInfo, isIOS, directionsUrl, carMapLink, carShareText, carDocTitle
  };
  if (typeof module !== 'undefined') module.exports = api; else root.NYCSigns = api;
})(this);
