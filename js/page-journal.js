/* ============================================================
   JOURNAL — reflection, ADHD-friendly (mostly taps / 1-5 stars).
   One entry per day with a MORNING + EVENING section, stored as
   d.morning{} / d.evening{} sub-objects (1-5 star ratings + light
   text). Legacy flat fields (mood word, sleep, meds, feelings) are
   kept and reused, so Insights/Shutdown keep working. A hidden
   insights view (reusing renderInsights) opens from within the page.
   ============================================================ */
let journalInsightsOpen=false;
/* optional, timestamped check-ins (stored in day.spotlogs — kept fully separate from
   the legacy day.checkins so Insights/Shutdown/word-cloud stay untouched) */
let checkinOpen=false;
let checkinDraft={mood:null,energy:null,calm:null,focus:null,note:''};
function freshCheckinDraft(){ checkinDraft={mood:null,energy:null,calm:null,focus:null,note:''}; }

/* a 5-star tap row bound to d[scope][field] (e.g. morning.energy) */
function starRow(scope, field, val){
  val=+val||0;
  return `<div class="star-row">${[1,2,3,4,5].map(n=>
    `<button class="star ${n<=val?'on':''}" data-jstar="${scope}|${field}|${n}" title="${n}">★</button>`).join('')}</div>`;
}

/* ---- optional check-ins (day.spotlogs) ---- */
function renderCheckins(){
  const logs=(day().spotlogs||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0));   // newest first
  const dots=(v)=>{ v=+v||0; return '●'.repeat(v)+'○'.repeat(5-v); };
  return `
  <div class="card checkin-card">
    <div class="card-h"><h3>Check-ins</h3><span class="ch-actions"><span class="sub">${logs.length} today</span>${checkinOpen?'':`<button class="btn sm" id="ciOpen">+ Check-in</button>`}</span></div>
    ${checkinOpen?renderCheckinForm():''}
    ${logs.length?`<div class="ci-list">${logs.map(c=>`
      <div class="ci-log">
        <span class="ci-time">${esc(fmtClock(c.time))}</span>
        <span class="ci-rats">
          <span class="ci-r" title="mood">m <span class="ci-dots">${dots(c.mood)}</span></span>
          <span class="ci-r" title="energy">e <span class="ci-dots">${dots(c.energy)}</span></span>
          <span class="ci-r" title="calm">c <span class="ci-dots">${dots(c.calm)}</span></span>
          <span class="ci-r" title="focus">f <span class="ci-dots">${dots(c.focus)}</span></span>
        </span>
        ${c.note?`<span class="ci-note">${esc(c.note)}</span>`:''}
        <span class="x" data-cidel="${c.id}" title="Delete check-in">×</span>
      </div>`).join('')}</div>`
    :(checkinOpen?'':'<p class="list-note" style="margin:6px 0 0">Optional — tap “+ Check-in” to log how you feel right now. No obligation, log as often (or as rarely) as you like.</p>')}
  </div>`;
}
function renderCheckinForm(){
  const dr=checkinDraft;
  const ciStar=(field)=>{ const val=+dr[field]||0; return `<div class="star-row">${[1,2,3,4,5].map(n=>`<button class="star ${n<=val?'on':''}" data-cistar="${field}|${n}" title="${n}">★</button>`).join('')}</div>`; };
  return `
  <div class="checkin-form">
    <div class="grid2">
      <div class="rate-field"><label>Mood</label>${ciStar('mood')}</div>
      <div class="rate-field"><label>Energy</label>${ciStar('energy')}</div>
    </div>
    <div class="grid2" style="margin-top:10px">
      <div class="rate-field"><label>Calm <span class="hint">5 = calm</span></label>${ciStar('calm')}</div>
      <div class="rate-field"><label>Focus <span class="hint">locked-in</span></label>${ciStar('focus')}</div>
    </div>
    <input type="text" id="ciNote" class="ci-note-in" value="${esc(dr.note||'')}" placeholder="optional note…">
    <div class="btn-row" style="margin-top:12px">
      <button class="btn sm" id="ciSave">✓ Log check-in</button>
      <button class="btn ghost sm" id="ciCancel">Cancel</button>
    </div>
  </div>`;
}
function saveCheckin(){
  const dr=checkinDraft;
  if(dr.mood==null && dr.energy==null && dr.calm==null && dr.focus==null && !(dr.note||'').trim()){
    toast('Tap a rating or add a note'); return;
  }
  const d=day(); if(!d.spotlogs) d.spotlogs=[];
  d.spotlogs.push({ id:b(), time:nowHM(), ts:Date.now(),
    mood:dr.mood, energy:dr.energy, calm:dr.calm, focus:dr.focus, note:(dr.note||'').trim() });
  freshCheckinDraft(); checkinOpen=false;
  save(); toast('Check-in logged ✓'); rerender();
}

/* ---- auto-log: read-only, computed per day ---- */
/* tasks completed on a given day: project tasks stamped doneAt===dk, done
   standalone day-tasks in that record, and swept archive entries. */
function journalCompletedFor(dk){
  const items=[];
  (S.projects||[]).forEach(p=>{
    (p.tasks||[]).forEach(t=>{ if(t.done && t.doneAt===dk) items.push({txt:t.txt, label:p.name}); });
  });
  const d=S.days[dk]||{};
  (d.tasks||[]).forEach(t=>{ if(t.done && !t.projectId && !t.meetingId) items.push({txt:t.txt, label:t.kind==='quick'?'Quick':'Task'}); });
  (d.archive||[]).forEach(a=>{ items.push({txt:a.txt, label:'Archived'}); });
  return { count:items.length, items };
}
/* appointments + meetings that landed on a given day */
function journalEventsFor(dk){
  const out=[];
  (S.appointments||[]).forEach(a=>{ if(a.date===dk) out.push({time:a.time||'', label:a.title, type:'appt'}); });
  (S.meetings||[]).forEach(m=>{ if(m.nextMeeting && m.nextMeeting.date===dk) out.push({time:(m.nextMeeting.time||''), label:m.name, type:'mtg'}); });
  out.sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  return out;
}

function renderJournal(){
  const d=day(); const m=d.morning||{}; const e=d.evening||{};
  const tk=todayKey();
  const done=journalCompletedFor(tk);
  const events=journalEventsFor(tk);
  return `
  <div class="phead compact">
    <div class="kicker">${prettyDate()}</div>
    <h2>Journal</h2>
    <p>Morning + evening check-in. Mostly taps — the more you log, the sharper the patterns get.</p>
  </div>

  ${renderCheckins()}

  <div class="card jrnl-card">
    <div class="card-h"><h3>🌅 Morning</h3><span class="sub">saved automatically</span></div>
    <div class="field"><label>Sleep last night</label>
      <input type="text" data-jrnl="sleep" value="${esc(d.sleep||'')}" placeholder="e.g. 7h, solid"></div>
    <div class="grid2">
      <div class="rate-field"><label>Mood</label>${starRow('morning','mood',m.mood)}</div>
      <div class="rate-field"><label>Energy</label>${starRow('morning','energy',m.energy)}</div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="rate-field"><label>Calm <span class="hint">5 = calm/relaxed</span></label>${starRow('morning','calm',m.calm)}</div>
      <div class="rate-field"></div>
    </div>
    <div class="field" style="margin-top:14px;margin-bottom:0"><label>Intentions <span class="hint">one line for today</span></label>
      <input type="text" data-jrnl2="morning|intentions" value="${esc(m.intentions||'')}" placeholder="today's intention…"></div>
  </div>

  <div class="card jrnl-card">
    <div class="card-h"><h3>🌙 Evening</h3><span class="sub">saved automatically</span></div>
    <div class="grid2">
      <div class="rate-field"><label>Mood</label>${starRow('evening','mood',e.mood)}</div>
      <div class="rate-field"><label>Energy</label>${starRow('evening','energy',e.energy)}</div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="rate-field"><label>Calm <span class="hint">5 = calm/relaxed</span></label>${starRow('evening','calm',e.calm)}</div>
      <div class="rate-field"><label>Fulfillment</label>${starRow('evening','fulfillment',e.fulfillment)}</div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="field" style="margin-bottom:0"><label>Training</label>
        <div class="train-toggle">
          <button class="tg ${e.trained===true?'on':''}" data-jtrain="1">✓ Trained</button>
          <button class="tg ${e.trained===false?'on':''}" data-jtrain="0">✗ Rest</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0"><label>Training note <span class="hint">optional</span></label>
        <input type="text" data-jrnl2="evening|trainNote" value="${esc(e.trainNote||'')}" placeholder="what / how long"></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="field" style="margin-bottom:0"><label>Medication / supplements</label>
        <input type="text" data-jrnl="meds" value="${esc(d.meds||'')}" placeholder="what you took today"></div>
      <div class="field" style="margin-bottom:0"><label>Diet <span class="hint">what you ate</span></label>
        <input type="text" data-jrnl2="evening|diet" value="${esc(e.diet||'')}" placeholder="meals, snacks…"></div>
    </div>
    <div class="field" style="margin-top:14px"><label>Reflection / feelings</label>
      <textarea data-jrnl="feelings" placeholder="How did today actually feel? Anything on your mind…">${esc(d.feelings||'')}</textarea></div>

    <div class="autolog">
      <div class="autolog-h">Auto-logged today <span class="hint">computed — no input needed</span></div>
      <div class="autolog-row"><span class="al-lab">✓ Completed</span><span class="al-val">${done.count} task${done.count===1?'':'s'}</span></div>
      ${done.count?`<div class="autolog-list">${done.items.map(it=>`<div class="al-item"><span class="al-txt">${esc(it.txt)}</span>${it.label?`<span class="al-tag">${esc(it.label)}</span>`:''}</div>`).join('')}</div>`:'<div class="empty sm">Nothing checked off yet.</div>'}
      <div class="autolog-row" style="margin-top:10px"><span class="al-lab">📅 Events</span><span class="al-val">${events.length}</span></div>
      ${events.length?`<div class="autolog-list">${events.map(ev=>`<div class="al-item">${ev.time?`<span class="al-time">${esc(fmtClock(ev.time))}</span> `:''}<span class="al-txt">${esc(ev.label)}</span><span class="al-tag">${ev.type==='mtg'?'meeting':'appt'}</span></div>`).join('')}</div>`:'<div class="empty sm">No appointments or meetings today.</div>'}
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Recent entries</h3><span class="sub">last 7 days</span></div>
    <div class="jrnl-history">${renderJournalHistory()}</div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Export journal data</h3><span class="sub">for trend analysis</span></div>
    <p class="list-note" style="margin-top:0">Download every entry to hand to Claude — e.g. mood vs sleep, fulfillment vs training, completed-tasks vs mood.</p>
    <div class="btn-row">
      <button class="btn ghost sm" id="jExportCsv">⬇ Export CSV</button>
      <button class="btn ghost sm" id="jExportCheckins">⬇ Export check-ins (CSV)</button>
      <button class="btn ghost sm" id="jExportJson">⬇ Export JSON</button>
    </div>
  </div>

  <button class="btn ghost" id="jInsightsToggle" style="width:100%">${journalInsightsOpen?'▾ Hide insights & patterns':'▸ Show insights & patterns'}</button>
  ${journalInsightsOpen?`<div class="jrnl-insights">${renderInsights()}</div>`:''}
  `;
}

function renderJournalHistory(){
  const keys=Object.keys(S.days||{}).sort().reverse().slice(0,7);
  if(!keys.length) return '<div class="empty sm">No entries yet — today is day one.</div>';
  const stars=(v)=> v?('★'.repeat(v)+'☆'.repeat(5-v)):'';
  return keys.map(k=>{
    const e=S.days[k]||{}; const mo=e.morning||{}; const ev=e.evening||{};
    const done=journalCompletedFor(k); const events=journalEventsFor(k);
    const moodStar=ev.mood||mo.mood;
    const enStar=ev.energy||mo.energy;
    const bits=[];
    if(moodStar) bits.push('mood '+stars(moodStar));
    if(enStar) bits.push('energy '+stars(enStar));
    if(ev.fulfillment) bits.push('fulfil '+stars(ev.fulfillment));
    if(e.sleep) bits.push(esc(e.sleep));
    return `<div class="jrnl-row">
      <span class="jr-date">${k===todayKey()?'Today':shortDate(k)}</span>
      <span class="jr-mood">${e.mood?esc(e.mood):(moodStar?stars(moodStar):'—')}</span>
      <span class="jr-meta">${bits.join(' · ')||'—'}</span>
      <span class="jr-auto" title="completed tasks · events">✓${done.count} · 📅${events.length}</span>
    </div>`;
  }).join('');
}

/* ---- export: every day record with its journal + auto-log ---- */
function journalExportRows(){
  return Object.keys(S.days||{}).sort().map(k=>{
    const d=S.days[k]||{}; const m=d.morning||{}; const e=d.evening||{};
    const done=journalCompletedFor(k); const events=journalEventsFor(k);
    return {
      date:k, sleep:d.sleep||'',
      m_energy:m.energy||'', m_mood:m.mood||'', m_calm:m.calm||'',
      intentions:m.intentions||'',
      e_mood:e.mood||'', e_energy:e.energy||'', e_calm:e.calm||'', fulfillment:e.fulfillment||'',
      trained:(e.trained===true?'yes':(e.trained===false?'no':'')), training_note:e.trainNote||'',
      meds:d.meds||'', diet:e.diet||'', reflection:d.feelings||'', mood_word:d.mood||'',
      completed_count:done.count, completed_tasks:done.items.map(i=>i.txt).join('; '),
      events:events.map(ev=>(ev.time?fmtClock(ev.time)+' ':'')+ev.label).join('; '),
      checkin_count:(d.spotlogs||[]).length,
    };
  });
}
const JOURNAL_COLS=['date','sleep','m_energy','m_mood','m_calm','intentions','e_mood','e_energy','e_calm','fulfillment','trained','training_note','meds','diet','reflection','mood_word','completed_count','completed_tasks','events','checkin_count'];
const CHECKIN_COLS=['date','time','mood','energy','calm','focus','note'];
function csvCell(v){ v=(v==null?'':String(v)); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function rowsToCsv(cols, rows){ return [cols.join(',')].concat(rows.map(r=>cols.map(c=>csvCell(r[c])).join(','))).join('\n'); }
function journalDownload(name, text, type){
  const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
}
function exportJournalCsv(){
  journalDownload('marcomaster-journal-'+todayKey()+'.csv', rowsToCsv(JOURNAL_COLS, journalExportRows()), 'text/csv');
  toast('Journal CSV exported ✓');
}
/* one row PER check-in across all days — for intraday analysis (focus by time, mood drift) */
function exportCheckinsCsv(){
  const rows=[];
  Object.keys(S.days||{}).sort().forEach(k=>{
    (S.days[k].spotlogs||[]).slice().sort((a,b)=>(a.ts||0)-(b.ts||0)).forEach(c=>{
      rows.push({ date:k, time:c.time||'', mood:c.mood||'', energy:c.energy||'', calm:c.calm||'', focus:c.focus||'', note:c.note||'' });
    });
  });
  journalDownload('marcomaster-checkins-'+todayKey()+'.csv', rowsToCsv(CHECKIN_COLS, rows), 'text/csv');
  toast('Check-ins CSV exported ✓');
}
function exportJournalJson(){
  const days=Object.keys(S.days||{}).sort().map(k=>{
    const d=S.days[k]||{}; const done=journalCompletedFor(k); const events=journalEventsFor(k);
    return { date:k, morning:d.morning||{}, evening:d.evening||{},
             sleep:d.sleep||'', meds:d.meds||'', reflection:d.feelings||'', moodWord:d.mood||'',
             completed:done, events, checkins:(d.spotlogs||[]) };
  });
  journalDownload('marcomaster-journal-'+todayKey()+'.json',
    JSON.stringify({ exportedAt:new Date().toISOString(), days }, null, 2), 'application/json');
  toast('Journal JSON exported ✓');
}

function bindJournal(){
  // legacy flat text fields (sleep, meds, feelings) → straight onto the day record
  q('[data-jrnl]','all').forEach(el=>el.oninput=()=>{ day()[el.dataset.jrnl]=el.value; save(); });
  // morning/evening text fields → into the sub-object (no rerender = no caret jump)
  q('[data-jrnl2]','all').forEach(el=>el.oninput=()=>{ const [scope,field]=el.dataset.jrnl2.split('|'); const d=day(); if(!d[scope]) d[scope]={}; d[scope][field]=el.value; save(); });
  // 1-5 star ratings (click a star to set; click the same star again to clear)
  q('[data-jstar]','all').forEach(el=>el.onclick=()=>{
    const [scope,field,n]=el.dataset.jstar.split('|'); const num=+n;
    const d=day(); if(!d[scope]) d[scope]={};
    d[scope][field]=(d[scope][field]===num)?null:num;
    save(false); rerender();
  });
  // training toggle (Trained / Rest)
  q('[data-jtrain]','all').forEach(el=>el.onclick=()=>{ const d=day(); if(!d.evening) d.evening={}; d.evening.trained=(el.dataset.jtrain==='1'); save(false); rerender(); });
  // ---- check-ins (day.spotlogs) ----
  const cio=q('#ciOpen'); if(cio) cio.onclick=()=>{ checkinOpen=true; rerender(); };
  q('[data-cistar]','all').forEach(el=>el.onclick=()=>{ const [field,n]=el.dataset.cistar.split('|'); const num=+n; checkinDraft[field]=(checkinDraft[field]===num)?null:num; rerender(); });
  const cin=q('#ciNote'); if(cin) cin.oninput=()=>{ checkinDraft.note=cin.value; };
  const cis=q('#ciSave'); if(cis) cis.onclick=saveCheckin;
  const cic=q('#ciCancel'); if(cic) cic.onclick=()=>{ freshCheckinDraft(); checkinOpen=false; rerender(); };
  q('[data-cidel]','all').forEach(el=>el.onclick=()=>{ const d=day(); d.spotlogs=(d.spotlogs||[]).filter(x=>x.id!==el.dataset.cidel); save(); rerender(); });
  // export
  const ec=q('#jExportCsv'); if(ec) ec.onclick=exportJournalCsv;
  const eck=q('#jExportCheckins'); if(eck) eck.onclick=exportCheckinsCsv;
  const ej=q('#jExportJson'); if(ej) ej.onclick=exportJournalJson;
  // hidden insights view (reuses renderInsights + bindInsights)
  const it=q('#jInsightsToggle'); if(it) it.onclick=()=>{ journalInsightsOpen=!journalInsightsOpen; rerender(); };
  if(journalInsightsOpen && typeof bindInsights==='function') bindInsights();
}
