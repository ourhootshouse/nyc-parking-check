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
    if (i.commercial) detail = (detail ? detail + ' ' : '') + '(Checked for commercial plates.)';
    if (detail) lines.push(detail);
    let out = lines.join('\n');
    if (i.url && i.linkInText) out += '\n\nCheck it in ParkHero: ' + i.url;
    return out;
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

  const api = {
    expandCityDescription, isLocator, compassRelative, signsForSlot,
    estimatePinDistance, groupPoles, pickFrontBehind,
    encodeState, decodeState, encodeStateV2, decodeStateV2, shareHash, stateFromHash,
    whenText, friendlyRule, signSummary, tidyAddress, shareText, shareSummary, icsEvent
  };
  if (typeof module !== 'undefined') module.exports = api; else root.NYCSigns = api;
})(this);
