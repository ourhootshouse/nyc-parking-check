// NYC parking sign parser + evaluator (works in browser and Node)
(function (root) {
  const TZ = 'America/New_York';
  const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const DAYNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYRE = '(SUNDAYS?|SUN|MONDAYS?|MON|TUESDAYS?|TUES?|WEDNESDAYS?|WED|THURSDAYS?|THURS?|THU|FRIDAYS?|FRI|SATURDAYS?|SAT)';
  function dayIdx(s){ s=s.toUpperCase(); for(let i=0;i<7;i++) if(s.startsWith(DAYS[i])) return i; return -1; }

  // ---- time zone helpers ----
  function nyParts(date){
    const f = new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,weekday:'short'});
    const p={}; for(const x of f.formatToParts(date)) p[x.type]=x.value;
    return {y:+p.year,m:+p.month,d:+p.day,h:(+p.hour)%24,min:+p.minute,dow:dayIdx(p.weekday)};
  }
  function nyToDate(y,m,d,h,min){ // wall clock NY -> Date
    let guess = Date.UTC(y,m-1,d,h,min);
    for(let i=0;i<3;i++){ const p=nyParts(new Date(guess)); const asUtc=Date.UTC(p.y,p.m-1,p.d,p.h,p.min); guess += Date.UTC(y,m-1,d,h,min)-asUtc; }
    return new Date(guess);
  }
  function ymd(p){ return `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`; }

  // ---- parsing ----
  function normalize(t){
    return (' '+t+' ').toUpperCase()
      .replace(/[\u2013\u2014~_=]/g,'-')
      .replace(/\bA\.?\s?M\.?\b/g,'AM').replace(/\bP\.?\s?M\.?\b/g,'PM')
      .replace(/(\d)\s*[;.]\s*(\d\d)/g,'$1:$2')
      .replace(/\bMIDNIGHT\b/g,'12AM').replace(/\bNOON\b/g,'12PM')
      .replace(/\b(THRU|THROUGH|TO)\b/g,'-')
      .replace(/\bHRS?\b|\bHOURS?\b/g,'HOUR')
      .replace(/\bEXCEPTING\b/g,'EXCEPT')
      .replace(/\s+/g,' ').trim();
  }
  function toMin(h,mm,ap){ h=+h; mm=+(mm||0); if(ap==='PM'&&h!==12)h+=12; if(ap==='AM'&&h===12)h=0; return h*60+mm; }
  function parseTimes(s){
    const out=[]; const re=/(\d{1,2})(?::(\d\d))?\s*(AM|PM)?\s*-\s*(\d{1,2})(?::(\d\d))?\s*(AM|PM)/g; let m;
    while((m=re.exec(s))){ let ap1=m[3]||m[6]; out.push([toMin(m[1],m[2],ap1),toMin(m[4],m[5],m[6])]); }
    return out;
  }
  function parseDays(s){
    let days=null; const notes=[];
    if(/SCHOOL DAYS/.test(s)){ days=[1,2,3,4,5]; notes.push('"School days" treated as Mon–Fri (no school calendar check).'); }
    const exc = s.match(new RegExp('EXCEPT\\s+'+DAYRE+'(?:\\s*(?:&|AND|,|-)\\s*'+DAYRE+')?'));
    if(exc){ const ex=[dayIdx(exc[1])]; if(exc[2]) ex.push(dayIdx(exc[2])); days=[0,1,2,3,4,5,6].filter(d=>!ex.includes(d)); s=s.replace(exc[0],' '); }
    const rng = s.match(new RegExp(DAYRE+'\\s*-\\s*'+DAYRE));
    if(rng){ const a=dayIdx(rng[1]),b=dayIdx(rng[2]); const r=[]; for(let d=a;;d=(d+1)%7){ r.push(d); if(d===b)break; } days=(days||r).filter(x=>r.includes(x)); s=s.replace(rng[0],' '); }
    const singles=[...s.matchAll(new RegExp('\\b'+DAYRE+'\\b','g'))].map(x=>dayIdx(x[1]));
    if(singles.length){ days=days?days.filter(d=>singles.includes(d)):[...new Set(singles)]; }
    return {days: days||[0,1,2,3,4,5,6], notes};
  }
  const KW = /(NO STOPPING|NO STANDING|NO PARKING|\d+\s*HOUR\s*(?:METERED\s*)?(?:PARKING|PARK)?|METERED PARKING|COMMERCIAL VEHICLES ONLY|STREET CLEANING|ALTERNATE SIDE)/g;
  function parse(text){
    const t=normalize(text); const idx=[]; let m; KW.lastIndex=0;
    while((m=KW.exec(t))) idx.push(m.index);
    const rules=[];
    if(!idx.length) return {rules, normalized:t};
    for(let i=0;i<idx.length;i++){
      const seg=t.slice(idx[i], idx[i+1]??t.length).trim();
      const r={raw:seg, notes:[]};
      if(/^NO STOPPING/.test(seg)) r.type='NO_STOPPING';
      else if(/^NO STANDING/.test(seg)) r.type='NO_STANDING';
      else if(/^NO PARKING/.test(seg)) r.type='NO_PARKING';
      else if(/^COMMERCIAL/.test(seg)) r.type='COMMERCIAL_ONLY';
      else if(/^(STREET CLEANING|ALTERNATE SIDE)/.test(seg)){ r.type='NO_PARKING'; r.streetCleaning=true; }
      else { r.type='TIME_LIMIT'; const h=seg.match(/(\d+)\s*HOUR/); r.limitMin=h?(+h[1])*60:60; r.metered=/METER|PAY|MUNI/.test(seg)||/METER/.test(t); }
      r.anytime=/ANYTIME|ANY TIME/.test(seg);
      r.times=r.anytime?[]:parseTimes(seg);
      const d=parseDays(seg); r.days=d.days; r.notes.push(...d.notes);
      if(r.anytime||!r.times.length){ r.times=[[0,1440]]; if(!r.anytime && r.type!=='TIME_LIMIT') r.notes.push('No hours found on this line, assuming it applies all day.'); if(!r.anytime && r.type==='TIME_LIMIT') r.notes.push('No hours found, assuming limit applies all day.'); }
      if(/BROOM|SANITATION|STREET CLEAN/.test(seg)) r.streetCleaning=true;
      // Heuristic: NO PARKING with a single short window on 1-2 days = typical ASP street cleaning sign
      if(r.type==='NO_PARKING' && !r.anytime && r.times.length===1 && r.days.length<=2){ const [a,b]=r.times[0]; if(((b-a+1440)%1440)<=180) { r.streetCleaning=r.streetCleaning??true; r.guessedSC=true; } }
      if(/TRUCK LOADING|COMMERCIAL/.test(seg) && r.type!=='COMMERCIAL_ONLY') r.notes.push('Has an exception for trucks/commercial loading. Passenger cars are still not allowed.');
      rules.push(r);
    }
    return {rules, normalized:t};
  }

  // ---- evaluation ----
  // holidays: {'YYYY-MM-DD': {asp:true, meters:true, name}}  (meters:true => meters + other rules suspended, except 7-day rules)
  function intervals(rule, now, holidays, daysAhead){
    const out=[]; const p0=nyParts(now);
    for(let k=-1;k<=daysAhead;k++){
      const base=new Date(Date.UTC(p0.y,p0.m-1,p0.d+k)); const y=base.getUTCFullYear(),m=base.getUTCMonth()+1,d=base.getUTCDate(); const dow=base.getUTCDay();
      if(!rule.days.includes(dow)) continue;
      const key=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const hol=holidays&&holidays[key];
      if(hol){
        if(rule.streetCleaning && hol.asp) continue;
        if(hol.meters && rule.days.length<7) continue; // major legal holiday: rules not in effect 7 days/wk are suspended
        if(hol.meters && rule.type==='TIME_LIMIT') continue;
      }
      for(const [a,b] of rule.times){
        const s=nyToDate(y,m,d,Math.floor(a/60),a%60);
        const endMin = b<=a ? b+1440 : b;
        const e=nyToDate(y,m,d+Math.floor(endMin/1440),Math.floor((endMin%1440)/60),endMin%60);
        out.push({start:s,end:e,rule});
      }
    }
    return out.sort((a,b)=>a.start-b.start);
  }
  function merge(iv){ const s=[...iv].sort((a,b)=>a.start-b.start); const o=[]; for(const x of s){ const l=o[o.length-1]; if(l&&x.start<=l.end){ if(x.end>l.end){l.end=x.end;} l.rules.push(x.rule);} else o.push({start:x.start,end:x.end,rules:[x.rule]}); } return o; }

  function evaluate(rules, now, holidays, opts={}){
    const isCommercial=!!opts.commercial; const ahead=15;
    let restr=[], limits=[];
    for(const r of rules){
      if(r.type==='COMMERCIAL_ONLY'){ if(!isCommercial) restr.push(...intervals(r,now,holidays,ahead)); continue; }
      if(r.type==='TIME_LIMIT'){ limits.push(...intervals(r,now,holidays,ahead)); continue; }
      restr.push(...intervals(r,now,holidays,ahead));
    }
    const merged=merge(restr);
    const cur=merged.find(x=>x.start<=now&&now<x.end);
    const res={now, rules};
    if(cur){
      res.canPark=false; res.okAt=cur.end; res.blockedBy=cur.rules;
      // if okAt falls inside a time-limit window, report the limit
      const lim=limits.find(x=>x.start<=cur.end&&cur.end<x.end); if(lim){ res.limitAtOk={minutes:lim.rule.limitMin, metered:lim.rule.metered, windowEnd:lim.end}; }
      if(cur.end-now>7*864e5) res.okAt=null; // anytime
      return res;
    }
    res.canPark=true;
    const next=merged.find(x=>x.start>now); res.nextViolation=next?next.start:null; res.nextRules=next?next.rules:[];
    const lim=limits.find(x=>x.start<=now&&now<x.end);
    if(lim){
      const mustLeave=new Date(Math.min(now.getTime()+lim.rule.limitMin*60000, lim.end.getTime()));
      res.limit={minutes:lim.rule.limitMin, metered:lim.rule.metered, windowEnd:lim.end};
      if(lim.end.getTime() > now.getTime()+lim.rule.limitMin*60000 && (!res.nextViolation||mustLeave<res.nextViolation)){ res.nextViolation=mustLeave; res.nextRules=[lim.rule]; res.violationIsTimeLimit=true; }
    } else {
      const nl=limits.find(x=>x.start>now);
      if(nl) res.upcomingLimit={start:nl.start, minutes:nl.rule.limitMin, metered:nl.rule.metered};
    }
    return res;
  }

  function fmt(d){ return d.toLocaleString('en-US',{timeZone:TZ,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function dur(ms){ const m=Math.round(ms/60000); const d=Math.floor(m/1440), h=Math.floor((m%1440)/60), mi=m%60; return [d?d+'d':'',h?h+'h':'',(mi||(!d&&!h))?mi+'m':''].filter(Boolean).join(' '); }
  function describe(r){
    const names={NO_STOPPING:'No Stopping',NO_STANDING:'No Standing',NO_PARKING:'No Parking',COMMERCIAL_ONLY:'Commercial Vehicles Only',TIME_LIMIT:(r.limitMin/60)+' Hour '+(r.metered?'Metered ':'')+'Parking'};
    const t=r.times.map(([a,b])=>(a===0&&b===1440)?'all day':`${hm(a)}–${hm(b)}`).join(', ');
    const d=r.days.length===7?'every day':r.days.map(x=>DAYNAMES[x].slice(0,3)).join(', ');
    return `${names[r.type]}${r.streetCleaning?' (street cleaning)':''} · ${r.anytime?'anytime':t} · ${d}`;
  }
  function hm(m){ m%=1440; const h=Math.floor(m/60), mi=m%60; const ap=h<12?'AM':'PM'; const hh=h%12||12; return mi?`${hh}:${String(mi).padStart(2,'0')}${ap}`:`${hh}${ap}`; }

  const api={parse,evaluate,describe,fmt,dur,nyParts,nyToDate,ymd,TZ};
  if(typeof module!=='undefined') module.exports=api; else root.NYCRules=api;
})(this);
