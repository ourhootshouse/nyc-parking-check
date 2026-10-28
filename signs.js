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

  function shareSummary(info) {
    const lines = ['Can I park here? NYC'];
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
      'PRODID:-//NYC Parking Check//EN',
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
    encodeState, decodeState, shareSummary, icsEvent
  };
  if (typeof module !== 'undefined') module.exports = api; else root.NYCSigns = api;
})(this);
