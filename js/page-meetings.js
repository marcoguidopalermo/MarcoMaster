/* ============================================================
   MEETINGS — recurring people / meetings (Manager, Mechanic, James…).
   Persistent like Projects: they stay until deleted. Each meeting holds
   a checkable list of TALKING POINTS (jot something to raise, check it
   off when covered) plus a free NOTES area for open context. Modeled on
   the Projects page (list of cards + add-input + per-item check/delete).
   Item: { id, name, points:[{id,txt,done}], notes:"", createdAt }
   ============================================================ */
let newMeetingName='';
let meetingDraftText={};   // {meetingId: in-progress new talking-point text}

function meetingStats(m){
  const pts=m.points||[];
  return {total:pts.length, done:pts.filter(p=>p.done).length};
}

function renderMeetings(){
  const meetings=S.meetings||[];
  const card=(m)=>{
    const pts=m.points||[];
    const s=meetingStats(m);
    return `
    <div class="proj-card meeting-card">
      <div class="proj-bar-top">
        <input type="text" class="proj-name-in" data-mname="${m.id}" value="${esc(m.name)}">
        <span class="proj-stat">${s.done}/${s.total}</span>
        <span class="x" data-mdel="${m.id}">×</span>
      </div>

      ${meetingIsRecurring(m)?`<div class="mtg-recur">⟳ ${esc(meetingRecurLabel(m))}</div>`:''}
      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)} <span class="mtg-cancel" data-mcancel="${m.id}" title="${meetingIsRecurring(m)?'Skip this occurrence — the recurrence continues':'Cancel this scheduled meeting'}">×</span></div>`:''}
      <button class="btn ghost sm mtg-sched-btn" data-msched="${m.id}">📅 ${m.nextMeeting?'Reschedule':'Schedule next meeting'}</button>

      <div class="mtg-section-lbl">Talking points</div>
      <div class="proj-tasks">
        ${pts.length?pts.map(p=>`
          <div class="ptask-row ${p.done?'done':''}">
            <span class="box" data-mpdone="${m.id}|${p.id}">✓</span>
            <span class="ptxt">${esc(p.txt)}</span>
            <span class="x" data-mpdel="${m.id}|${p.id}">×</span>
          </div>`).join(''):'<div class="empty sm">No talking points yet.</div>'}
      </div>
      <div class="proj-add-task">
        <input type="text" data-mpadd="${m.id}" value="${esc(meetingDraftText[m.id]||'')}" placeholder="Add a talking point for ${esc(m.name)}...">
        <button class="btn sm" data-mpaddbtn="${m.id}">+</button>
      </div>

      <div class="mtg-section-lbl">Notes</div>
      <textarea class="mtg-notes" data-mnotes="${m.id}" placeholder="Open notes / context for ${esc(m.name)}…">${esc(m.notes||'')}</textarea>
    </div>`;
  };
  return `
  <div class="phead">
    <div class="kicker">People &amp; recurring meetings</div>
    <h2>Meetings</h2>
    <p>Jot talking points as they come up, check them off when covered, and keep running notes per person.</p>
  </div>

  <div class="proj-stack">
    ${meetings.length?meetings.map(card).join(''):'<div class="empty">No meetings yet. Add one below.</div>'}
  </div>

  <div class="card" style="margin-top:16px">
    <div class="proj-add">
      <input type="text" id="newMeeting" value="${esc(newMeetingName)}" placeholder="New meeting or person (e.g. Manager, Mechanic, James)...">
      <button class="btn" id="addMeeting">Add</button>
    </div>
  </div>
  `;
}

function bindMeetings(){
  // rename meeting (save without re-render so typing doesn't jump)
  q('[data-mname]','all').forEach(el=>el.oninput=()=>{ const m=(S.meetings||[]).find(x=>x.id===el.dataset.mname); if(m){ m.name=el.value; save(); } });
  // delete meeting
  q('[data-mdel]','all').forEach(el=>el.onclick=()=>{
    const m=(S.meetings||[]).find(x=>x.id===el.dataset.mdel); if(!m) return;
    if(confirm(`Delete meeting "${m.name}" and its talking points + notes?`)){
      removeMeetingLinks(m);   // also clean up its linked appointment + calendar block
      S.meetings=(S.meetings||[]).filter(x=>x.id!==m.id); save(); rerender();
    }
  });
  // free-notes autosave (no re-render — keep the caret where it is)
  q('[data-mnotes]','all').forEach(el=>el.oninput=()=>{ const m=(S.meetings||[]).find(x=>x.id===el.dataset.mnotes); if(m){ m.notes=el.value; save(); } });

  // talking point: check / uncheck
  q('[data-mpdone]','all').forEach(el=>el.onclick=()=>{
    const [mid,pid]=el.dataset.mpdone.split('|');
    const m=(S.meetings||[]).find(x=>x.id===mid); const p=m&&(m.points||[]).find(x=>x.id===pid);
    if(p){ p.done=!p.done; save(false); rerender(); }
  });
  // talking point: delete
  q('[data-mpdel]','all').forEach(el=>el.onclick=()=>{
    const [mid,pid]=el.dataset.mpdel.split('|');
    const m=(S.meetings||[]).find(x=>x.id===mid); if(m){ m.points=(m.points||[]).filter(x=>x.id!==pid); save(); rerender(); }
  });
  // talking point: add (draft on input, commit on Enter / +)
  q('[data-mpadd]','all').forEach(el=>el.oninput=()=>{ meetingDraftText[el.dataset.mpadd]=el.value; });
  q('[data-mpadd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter') addMeetingPoint(el.dataset.mpadd); });
  q('[data-mpaddbtn]','all').forEach(el=>el.onclick=()=>addMeetingPoint(el.dataset.mpaddbtn));

  // schedule / reschedule the next meeting (date+time picker → appointment + block)
  q('[data-msched]','all').forEach(el=>el.onclick=()=>openMeetingSchedule(el.dataset.msched));
  // cancel / remove the scheduled next meeting (clean up its appointment + block)
  q('[data-mcancel]','all').forEach(el=>el.onclick=()=>{ if(cancelMeetingSchedule(el.dataset.mcancel)) rerender(); });

  // add a meeting
  const ni=q('#newMeeting'); if(ni) ni.oninput=()=>{ newMeetingName=ni.value; };
  const add=q('#addMeeting'); if(add) add.onclick=()=>{ if(createMeeting(newMeetingName)){ newMeetingName=''; rerender(); } };
  if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addMeeting').click(); };
}
/* create a meeting from a name; returns the new meeting (falsy if not created).
   Shared by the Meetings tab add-input, the Dashboard inline "+" and the overlay,
   so the logic lives in one place. Callers that only need "did it work?" still
   read it as a boolean; the ones that open the new meeting's detail straight away
   use the returned object. */
function createMeeting(name){
  const v=(name||'').trim(); if(!v) return null;
  if(!S.meetings) S.meetings=[];
  const m={id:b(), name:v, points:[], notes:'', createdAt:Date.now(), nextMeeting:null, apptId:null, blockId:null};
  S.meetings.push(m);
  save(); return m;
}

/* add a talking point to a meeting. The single writer for m.points — shared by the
   Meetings card input, the meeting modal, and unified Capture, so the point shape
   lives in exactly one place. Returns true if it was added. */
function createMeetingPoint(mid, txt){
  const v=(txt||'').trim(); if(!v) return false;
  // appendMeetingPoint (state-core.js) is shared with the MCP connector; false if the meeting is gone
  if(!appendMeetingPoint(S, mid, {id:b(), txt:v, done:false})) return false;
  save();
  return true;
}
function addMeetingPoint(mid){
  if(!createMeetingPoint(mid, meetingDraftText[mid])) return;
  meetingDraftText[mid]=''; rerender();
}

/* ---------- what the dashboard's Meetings hub card shows ----------
   The dashboard no longer previews meetings at all — it has one big card into the
   overlay below, and this is the single live number on it: how many people have
   something waiting to be raised. Captioned with what's actually booked. */
function mtgOpenPoints(m){ return (m.points||[]).filter(p=>!p.done).length; }
/* live = scheduled, or points waiting. A meeting with neither is quiet: nothing
   is owed to it today. Used by the overlay's grouping too. */
function mtgLive(m){ return !!(m.nextMeeting && m.nextMeeting.date) || mtgOpenPoints(m)>0; }

function mtgHubStat(){
  const all=S.meetings||[];
  const waiting=all.filter(m=>mtgOpenPoints(m)>0);
  const sched=all.filter(m=>m.nextMeeting&&m.nextMeeting.date).length;
  return {
    id:'hubMtgs', ic:'◇', name:'Meetings', color:'var(--amber)',
    n: waiting.length,
    sub: sched ? `${sched} scheduled` : (waiting.length ? 'with points waiting' : (all.length?'nothing waiting':'none yet')),
  };
}

/* ============================================================
   THE MEETINGS OVERLAY — every meeting visible at once.
   Same .pick-screen component and same reasoning as the projects overlay: one
   host OUTSIDE .app (#mtgScreen), shared header / group / row markup, and
   fitPickScreen()'s density step-down instead of a scrollbar. A row opens the
   EXISTING meeting modal rather than reimplementing the detail.
   ============================================================ */
let mtgScreenOpen=false;
function openMtgScreen(){ mtgScreenOpen=true; paintMtgScreen(); }
function closeMtgScreen(){ mtgScreenOpen=false; paintMtgScreen(); rerender(); }

/* Scheduled / waiting / quiet — the same three states the dashboard filters on,
   made explicit. Scheduled sorts by date so the next one you'll actually walk
   into is first. */
function mtgGroups(){
  const all=S.meetings||[];
  const sched=all.filter(m=>m.nextMeeting&&m.nextMeeting.date)
                 .sort((a,b)=>(a.nextMeeting.date+ (a.nextMeeting.time||'')).localeCompare(b.nextMeeting.date+(b.nextMeeting.time||'')));
  const rest=all.filter(m=>!(m.nextMeeting&&m.nextMeeting.date));
  return [
    {title:'Scheduled',      color:'var(--accent)',  cls:'', items:sched},
    {title:'Points waiting', color:'var(--amber)',   cls:'', items:rest.filter(m=>mtgOpenPoints(m)>0)},
    {title:'Quiet',          color:'var(--txt-dim)', cls:'', items:rest.filter(m=>mtgOpenPoints(m)===0)},
  ].filter(g=>g.items.length);
}
function mtgRowHTML(m){
  const s=meetingStats(m), open=mtgOpenPoints(m);
  const when=(m.nextMeeting&&m.nextMeeting.date)
    ? apptDateLabel(m.nextMeeting.date)+' · '+fmtClock(m.nextMeeting.time)
    : (s.total?`${s.done}/${s.total} covered`:'no points');
  const rec=meetingIsRecurring(m);
  return `<button class="pick-row" data-mtgrow="${m.id}" title="${rec?esc(meetingRecurLabel(m))+' — ':''}Open ${esc(m.name)}">
    <span class="proj-swatch" style="background:var(--accent)"></span>
    <span class="pick-txt">${esc(m.name)}</span>
    ${rec?`<span class="pick-ic" title="${esc(meetingRecurLabel(m))}">⟳</span>`:''}
    ${open?`<span class="pick-badge warm">${open}</span>`:''}
    <span class="pick-meta">${esc(when)}</span>
  </button>`;
}
function mtgScreenHTML(){
  const groups=mtgGroups();
  const total=groups.reduce((n,g)=>n+g.items.length,0);
  const waiting=(S.meetings||[]).reduce((n,m)=>n+mtgOpenPoints(m),0);
  const group=(g)=>`<section class="pick-group ${g.cls}" style="--gc:${g.color}">
      <h3 class="pick-g-title">${esc(g.title)}<span class="pick-g-ct">${g.items.length}</span></h3>
      <div class="pick-rows">${g.items.map(mtgRowHTML).join('')}</div>
    </section>`;
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>◇ Meetings</h2>
        <p>Every person and recurring meeting at once. Open one to check off talking points — the dashboard keeps only what's live.</p></div>
      <span class="pick-h-ct">${waiting} point${waiting===1?'':'s'} waiting</span>
      <button class="btn ghost sm" id="mtgScreenAdd">+ New meeting</button>
      <button class="pick-close" id="mtgScreenClose" title="Close">×</button>
    </header>
    ${total
      ? `<div class="pick-body">${groups.map(group).join('')}</div>`
      : `<div class="empty">No meetings yet. Add the people you meet with regularly.</div>`}
  </div>`;
}
function paintMtgScreen(){
  const el=q('#mtgScreen'); if(!el) return;
  if(!mtgScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=mtgScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindMtgScreen();
  fitPickScreen(el);     // re-fit: rows move between groups as points get covered
}
function bindMtgScreen(){
  const cl=q('#mtgScreenClose'); if(cl) cl.onclick=closeMtgScreen;
  // A row opens the existing meeting modal, which paints ABOVE the overlay and
  // already ends every mutation in rerender(); closeReset() repaints this overlay.
  q('#mtgScreen [data-mtgrow]','all').forEach(el=>el.onclick=()=>openMeetingModal(el.dataset.mtgrow));
  const ad=q('#mtgScreenAdd'); if(ad) ad.onclick=()=>{
    const v=prompt('New meeting / person'); const m=v&&createMeeting(v);
    if(m){ paintMtgScreen(); rerender(); openMeetingModal(m.id); }   // straight into its points
  };
}

/* ---------- meeting quick-view modal (mirrors the project task modal) ---------- */
let meetingModalId=null;
let meetingModalDraft='';
let meetingLogOpen=false;   // the Log panel — collapsed on every open, so the working view stays the working view
function openMeetingModal(mid){ meetingModalId=mid; meetingModalDraft=''; meetingLogOpen=false; renderMeetingModal(); }

/* ---------- the Log panel: past occurrences, newest first ----------
   Collapsed by default. The point of the modal is the NEXT meeting; the log is
   what you open when you need to remember the last one. */
function meetingLogEntries(m){
  return (m.log||[]).slice().sort((a,b)=>
    String(b.date||'').localeCompare(String(a.date||'')) || ((b.loggedAt||0)-(a.loggedAt||0)));
}
function meetingLogEntryHTML(e){
  const pts=e.points||[];
  const covered=pts.filter(p=>p.done);
  const carried=pts.length-covered.length;
  return `<div class="mlog-entry">
    <div class="mlog-date">${esc(apptDateLabel(e.date))}</div>
    ${e.notes
      ? `<div class="mlog-notes">${esc(e.notes)}</div>`
      : `<div class="mlog-empty">No notes written.</div>`}
    ${covered.length?`
      <div class="mlog-lbl">Covered</div>
      <div class="mlog-points">${covered.map(p=>`<div class="mlog-pt">✓ ${esc(p.txt)}</div>`).join('')}</div>`:''}
    ${carried?`<div class="mlog-carried">${carried} point${carried===1?'':'s'} still open, carried forward</div>`:''}
  </div>`;
}
function meetingLogHTML(m){
  const entries=meetingLogEntries(m);
  if(!entries.length) return '';
  return `
    <div class="panel ${meetingLogOpen?'open':''}" style="margin-top:14px">
      <button class="panel-h" id="mmLogToggle">
        <span class="panel-caret">${meetingLogOpen?'▾':'▸'}</span>
        <span class="panel-title">Log</span>
        <span class="panel-meta">${entries.length} past meeting${entries.length===1?'':'s'}</span>
      </button>
      ${meetingLogOpen?`<div class="panel-body"><div class="mlog-list">${entries.map(meetingLogEntryHTML).join('')}</div></div>`:''}
    </div>`;
}
function renderMeetingModal(){
  const m=(S.meetings||[]).find(x=>x.id===meetingModalId); if(!m){ closeReset(); return; }
  const pts=m.points||[];
  const el=q('#resetModal');
  el.innerHTML=`
    <div class="modal modal-lg">
      <span class="modal-close" id="mmClose">×</span>
      <h3><span class="proj-swatch" style="background:var(--accent);display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(m.name)}</h3>
      ${meetingIsRecurring(m)?`<div class="mtg-recur">⟳ ${esc(meetingRecurLabel(m))}</div>`:''}
      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)} <span class="mtg-cancel" data-mcancel="${m.id}" title="${meetingIsRecurring(m)?'Skip this occurrence — the recurrence continues':'Cancel this scheduled meeting'}">×</span></div>`:''}
      <button class="btn ghost sm mtg-sched-btn" id="mmSched">📅 ${m.nextMeeting?'Reschedule':'Schedule next meeting'}</button>
      <div class="mtg-section-lbl">Talking points</div>
      <div class="pm-tasks">
        ${pts.length?pts.map(p=>`
          <div class="pm-row ${p.done?'done':''}">
            <span class="box" data-mmdone="${p.id}">✓</span>
            <span class="pm-txt">${esc(p.txt)}</span>
            <span class="x" data-mmdel="${p.id}">×</span>
          </div>`).join(''):'<div class="empty sm">No talking points yet — add one below.</div>'}
      </div>
      <div class="proj-add-task" style="margin-top:12px">
        <input type="text" id="mmAdd" value="${esc(meetingModalDraft)}" placeholder="Add a talking point for ${esc(m.name)}…">
        <button class="btn sm" id="mmAddBtn">+ Add</button>
      </div>
      <div class="plan-row"><button class="plan-btn" id="mmPlan" title="Adds a quick task “${esc(planTaskTitle(m.name))}” to All Tasks">Plan this</button></div>
      <div class="mtg-section-lbl">Notes</div>
      <textarea class="mtg-notes" id="mmNotes" placeholder="What was discussed? Cleared into the log when this meeting is done.">${esc(m.notes||'')}</textarea>
      ${meetingLogHTML(m)}
      <p class="list-note" style="margin-top:10px">Quick view · full management on the Meetings tab</p>
      <div class="mtg-danger" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
        <button class="btn danger sm" id="mmDelMeeting">Delete meeting</button>
      </div>
    </div>`;
  el.classList.add('show');
  bindMeetingModal();
}
function bindMeetingModal(){
  const m=(S.meetings||[]).find(x=>x.id===meetingModalId); if(!m) return;
  const close=q('#mmClose'); if(close) close.onclick=()=>{ meetingModalId=null; closeReset(); };
  // re-render the modal AND the dashboard strip on every change (rerender only rebuilds #main)
  q('[data-mmdone]','all').forEach(el=>el.onclick=()=>{ const p=(m.points||[]).find(x=>x.id===el.dataset.mmdone); if(p){ p.done=!p.done; save(false); renderMeetingModal(); rerender(); } });
  q('[data-mmdel]','all').forEach(el=>el.onclick=()=>{ m.points=(m.points||[]).filter(x=>x.id!==el.dataset.mmdel); save(); renderMeetingModal(); rerender(); });
  const ai=q('#mmAdd'); if(ai) ai.oninput=()=>{ meetingModalDraft=ai.value; };
  const addP=()=>{ if(!createMeetingPoint(m.id, meetingModalDraft)) return; meetingModalDraft=''; renderMeetingModal(); rerender(); };
  const ab=q('#mmAddBtn'); if(ab) ab.onclick=addP;
  if(ai) ai.onkeydown=e=>{ if(e.key==='Enter') addP(); };
  const nt=q('#mmNotes'); if(nt) nt.oninput=()=>{ m.notes=nt.value; save(); };   // autosave; no re-render (keep caret)
  // Log panel — modal-only repaint; nothing on the dashboard changes by opening it
  const lt=q('#mmLogToggle'); if(lt) lt.onclick=()=>{ meetingLogOpen=!meetingLogOpen; renderMeetingModal(); };
  // "Plan this" — an ordinary quick task; rerender only, so All Tasks shows it
  const pl=q('#mmPlan'); if(pl) pl.onclick=()=>{ if(planThis(m.name)) rerender(); };
  const sc=q('#mmSched'); if(sc) sc.onclick=()=>openMeetingSchedule(meetingModalId);
  q('[data-mcancel]','all').forEach(el=>el.onclick=()=>{ if(cancelMeetingSchedule(el.dataset.mcancel)){ renderMeetingModal(); rerender(); } });
  // delete the whole meeting — person, talking points, notes — and cancel anything scheduled
  const dm=q('#mmDelMeeting'); if(dm) dm.onclick=()=>{
    if(!confirm(`Delete meeting "${m.name}"? This removes the person, all talking points and notes, and cancels anything scheduled. This can't be undone.`)) return;
    removeMeetingLinks(m);   // clean up its linked appointment + calendar block
    S.meetings=(S.meetings||[]).filter(x=>x.id!==m.id);
    save();
    meetingModalId=null; closeReset();
    rerender();
  };
}

/* ============================================================
   MEETING SCHEDULING — pick a date+time → one linked APPOINTMENT
   (S.appointments) + one calendar BLOCK (a kind:'project' task the
   Time Blocker grid renders). Reschedule UPDATES the same two records
   by their stored ids (m.apptId / m.blockId), never duplicating; if a
   linked record was deleted elsewhere it is recreated cleanly.
   ============================================================ */
function meetingHour(time){ const [h,mn]=String(time||'').split(':').map(Number); return (h||0)+((mn||0)/60); }
function meetingNextLabel(m){
  if(!m.nextMeeting || !m.nextMeeting.date) return '';
  return 'Next: '+apptDateLabel(m.nextMeeting.date)+', '+fmtClock(m.nextMeeting.time);
}

/* ============================================================
   RECURRENCE — deliberately NOT the recurring-TASK engine.
   A meeting recurrence produces an APPOINTMENT, not a task, so the two systems
   stay separate: nothing here touches S.recurring, syncRecurringIntoToday, or a
   task's recurringId, and nothing there knows meetings exist.

   The pattern lives on the meeting as m.recur:
     { freq:'weekly'|'biweekly'|'monthly', time:'HH:MM', dow:0-6, dom:1-31,
       anchor:'YYYY-MM-DD' }
   `anchor` is a known-good occurrence date and is what gives biweekly its phase;
   weekly/monthly could be derived from dow/dom alone but use it for consistency.

   ONLY ONE OCCURRENCE EVER EXISTS. The next occurrence is a real linked
   appointment + calendar block, exactly like a one-off meeting's — which is the
   whole point: the calendar, the ☀ Today strip and push reminders all keep
   working with no Cloud Function changes. Occurrences are never materialised as a
   series; the one after this one is computed from the pattern when this one is
   completed or passes (see syncMeetingRecurrences).
   ============================================================ */
const MTG_FREQS=[['once','One-off'],['weekly','Weekly'],['biweekly','Every 2 weeks'],['monthly','Monthly']];
const MTG_DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function meetingIsRecurring(m){ return !!(m && m.recur && m.recur.freq && m.recur.freq!=='once'); }
function ordinal(n){ const s=(n%10===1&&n!==11)?'st':(n%10===2&&n!==12)?'nd':(n%10===3&&n!==13)?'rd':'th'; return n+s; }
/* "Every Tuesday · 9:00am" — shown on the card, the modal and the overlay row */
function meetingRecurLabel(m){
  if(!meetingIsRecurring(m)) return '';
  const r=m.recur, t=fmtClock(r.time);
  if(r.freq==='weekly')   return `Every ${MTG_DOW[r.dow||0]} · ${t}`;
  if(r.freq==='biweekly') return `Every 2 weeks on ${MTG_DOW[r.dow||0]} · ${t}`;
  if(r.freq==='monthly')  return `Monthly on the ${ordinal(r.dom||1)} · ${t}`;
  return '';
}
/* has this {date,time} moment already gone by? */
function meetingMomentPassed(date, time){
  if(!date) return false;
  const [y,mo,d]=date.split('-').map(Number);
  const [h,mn]=String(time||'23:59').split(':').map(Number);
  return new Date(y,mo-1,d,h||0,mn||0,0).getTime() < Date.now();
}
/* The FIRST occurrence strictly after `afterKey`. Pure computation from the
   pattern — nothing is read from or written to storage. */
function meetingNextDate(r, afterKey){
  if(!r || !r.freq || r.freq==='once') return null;
  const after=dateFromKey(afterKey);
  if(r.freq==='weekly' || r.freq==='biweekly'){
    const step=(r.freq==='biweekly')?14:7;
    let d=dateFromKey(r.anchor||afterKey);
    if(d.getTime()<=after.getTime()){
      const gap=Math.round((after.getTime()-d.getTime())/86400000);
      d=new Date(d.getFullYear(), d.getMonth(), d.getDate()+(Math.floor(gap/step)+1)*step);
    }
    return keyFromDate(d);
  }
  if(r.freq==='monthly'){
    let y=after.getFullYear(), mo=after.getMonth();
    for(let i=0;i<60;i++){
      const last=new Date(y,mo+1,0).getDate();          // clamp: the 31st in a 30-day month lands on the 30th
      const cand=new Date(y,mo,Math.min(r.dom||1,last));
      if(cand.getTime()>after.getTime()) return keyFromDate(cand);
      mo++; if(mo>11){ mo=0; y++; }
    }
  }
  return null;
}
/* The first occurrence from TODAY when a pattern is set: today counts if it
   matches and its time hasn't already gone by, so "every Tuesday 9am" set on a
   Tuesday morning schedules today, not next week. */
function meetingFirstDate(r){
  const tk=todayKey();
  if(r.freq==='monthly'){
    const now=dateFromKey(tk);
    let y=now.getFullYear(), mo=now.getMonth();
    for(let i=0;i<60;i++){
      const last=new Date(y,mo+1,0).getDate();
      const cand=new Date(y,mo,Math.min(r.dom||1,last));
      const key=keyFromDate(cand);
      if(cand.getTime()>=now.getTime() && !meetingMomentPassed(key, r.time)) return key;
      mo++; if(mo>11){ mo=0; y++; }
    }
    return null;
  }
  let d=dateFromKey(tk);
  for(let i=0;i<15;i++){                                 // two weeks covers weekly and biweekly's first hit
    const key=keyFromDate(d);
    if(d.getDay()===(r.dow||0) && !meetingMomentPassed(key, r.time)) return key;
    d=new Date(d.getFullYear(), d.getMonth(), d.getDate()+1);
  }
  return null;
}

/* Apply a pattern (or clear it). r===null / freq 'once' STOPS the repeat but
   KEEPS whatever occurrence is currently booked — it simply becomes an ordinary
   one-off appointment, so switching back to one-off never silently loses a
   meeting you already have in the diary. Returns true if anything changed. */
function setMeetingRecurrence(m, r){
  if(!m) return false;
  if(!r || r.freq==='once'){ m.recur=null; save(); return true; }
  const first=meetingFirstDate(r);
  if(!first) return false;
  m.recur={ freq:r.freq, time:r.time, dow:r.dow, dom:r.dom, anchor:first };
  scheduleMeeting(m, first, r.time);   // saves
  return true;
}
/* Move a recurring meeting on to its next occurrence. Returns true if it moved. */
function advanceMeetingRecurrence(m){
  if(!meetingIsRecurring(m)) return false;
  const from=(m.nextMeeting && m.nextMeeting.date) || todayKey();
  const next=meetingNextDate(m.recur, from);
  if(!next) return false;
  // Snapshot the occurrence we're leaving BEFORE its records move on. This is what
  // catches an occurrence whose time simply passed (syncMeetingRecurrences never
  // ticks anything): if you wrote it up, it happened. The call is idempotent, so
  // the tick paths having already snapshotted is harmless.
  completeMeetingOccurrence(m, from);
  // Release a COMPLETED occurrence rather than reusing its records: a ticked
  // appointment has to stay in the archive as the evidence that this one
  // happened, and its calendar block has to stay on the day it happened. An
  // occurrence that merely passed without being ticked is reused instead, so a
  // missed meeting doesn't litter the archive with empty rows.
  const prevAppt=m.apptId && (S.appointments||[]).find(a=>a.id===m.apptId);
  if(prevAppt && prevAppt.done) m.apptId=null;
  const prevBlock=m.blockId && findTaskGlobal(m.blockId);
  if(prevBlock && prevBlock.t.done) m.blockId=null;
  scheduleMeeting(m, next, m.recur.time);   // saves; creates fresh records where released
  return true;
}
/* Roll every recurring meeting forward until its booked occurrence is in the
   future. Called on load and whenever an appointment is completed, so there is
   always exactly one pending occurrence and never a generated series. */
function syncMeetingRecurrences(){
  let changed=false;
  (S.meetings||[]).forEach(m=>{
    if(!meetingIsRecurring(m)) return;
    const appt=m.apptId && (S.appointments||[]).find(a=>a.id===m.apptId);
    const nm=m.nextMeeting;
    const booked = appt && !appt.done && nm && nm.date && !meetingMomentPassed(nm.date, nm.time);
    if(booked) return;
    // A meeting untouched for months walks forward a step at a time; the cap is a
    // runaway guard, not a limit anyone should reach (200 weeks ≈ 4 years).
    for(let i=0;i<200;i++){
      if(!advanceMeetingRecurrence(m)) break;
      changed=true;
      const n=m.nextMeeting;
      if(n && !meetingMomentPassed(n.date, n.time)) break;
    }
  });
  if(changed) save(false);
  return changed;
}
/* ============================================================
   THE MEETING LOG — history, because points and notes are working state.
   Talking points accumulate undated and notes are one string edited in place, so
   without this a meeting has no past: you cannot see what you discussed last time,
   only the residue of it.

   An entry is a SNAPSHOT of the occurrence as it stood when it finished:
     { id, date, loggedAt, notes, points:[{txt, done}] }
   Points are stored with their done state, so an entry records both what was
   covered and what was still open at the time.

   After snapshotting, the working set is cleaned for the next meeting: notes are
   cleared (they belong to the meeting that just happened) and COVERED points are
   removed (they're in the entry now). Open points stay on the agenda — they
   weren't discussed, so they're still owed.

   Nothing is ever reconstructed: entries only exist for occurrences that finished
   after this shipped. Existing points carry no dates and cannot be attributed.
   ============================================================ */

/* THE choke point. Every way of finishing an occurrence ends here — ticking its
   appointment, ticking its calendar block on the Time Blocker, or a recurrence
   rolling on (which also covers one whose time merely passed).

   IDEMPOTENT PER OCCURRENCE: a second call for the same date is a no-op, so it
   does not matter how many entry points fire for one completion, or in what
   order. Returns true only when an entry was actually written. */
function completeMeetingOccurrence(m, dateKey){
  if(!m) return false;
  const date = dateKey || (m.nextMeeting && m.nextMeeting.date);
  if(!date) return false;
  if(!Array.isArray(m.log)) m.log=[];
  if(m.log.some(e=>e && e.date===date)) return false;      // already snapshotted
  const points=(m.points||[]);
  const notes=String(m.notes||'').trim();
  const covered=points.filter(p=>p.done);
  // Nothing written and nothing ticked → the occurrence left no trace worth
  // keeping. An empty entry would be noise in the log, not history.
  if(!notes && !covered.length) return false;
  m.log.unshift({
    id:b(), date, loggedAt:Date.now(), notes,
    points: points.map(p=>({txt:p.txt, done:!!p.done})),
  });
  m.points=points.filter(p=>!p.done);   // covered ones are recorded above
  m.notes='';
  save(false);
  return true;
}
/* Finish an occurrence: snapshot it, then roll a recurring meeting on to the next.
   The two tick paths (appointment, calendar block) both come through here, so they
   behave identically; one-off meetings simply have nothing to advance. */
function finishMeetingOccurrence(m, date){
  if(!m) return false;
  const logged=completeMeetingOccurrence(m, date);
  if(meetingIsRecurring(m)) advanceMeetingRecurrence(m);
  return logged;
}
/* Block → meeting. The mirror of syncMeetingBlockFromAppt: ticking a meeting's
   block on the Time Blocker completes the occurrence exactly as ticking its
   appointment does — same appointment state, same snapshot, same advance. Writes
   appt.done directly and never calls back into toggleApptDone, so the two
   directions can't loop. Un-ticking is a correction, and never logs or advances. */
function syncMeetingFromBlock(t){
  if(!t || !t.meetingId) return false;
  const m=(S.meetings||[]).find(x=>x && x.id===t.meetingId);
  if(!m) return false;
  const appt=m.apptId && (S.appointments||[]).find(a=>a.id===m.apptId);
  if(appt) appt.done=!!t.done;
  if(!t.done) return false;
  const date=(appt&&appt.date) || t.schedDate || (m.nextMeeting&&m.nextMeeting.date);
  finishMeetingOccurrence(m, date);
  return true;
}

/* Ticking a meeting's appointment ticks its calendar block too, and un-ticking
   reopens it — so the block stays a truthful record of whether the meeting
   actually happened. Mirrors syncWorkoutFromAppt for training sessions, and like
   it, writes t.done directly and never calls back into toggleApptDone.

   This also underpins recurrence: advanceMeetingRecurrence leaves a COMPLETED
   block on the day it happened and books a fresh one, so without this the
   finished block would be dragged forward onto the next occurrence's date. */
function syncMeetingBlockFromAppt(a){
  if(!a) return;
  const m=(S.meetings||[]).find(x=>x && x.apptId===a.id);
  if(!m || !m.blockId) return;
  const ref=findTaskGlobal(m.blockId);
  if(ref) ref.t.done=!!a.done;
}
/* remove the appointment + calendar block linked to a meeting (used on delete) */
function removeMeetingLinks(m){
  if(m.apptId){ S.appointments=(S.appointments||[]).filter(a=>a.id!==m.apptId); }
  if(m.blockId){ const ref=findTaskGlobal(m.blockId); if(ref){ S.days[ref.dayKey].tasks=(S.days[ref.dayKey].tasks||[]).filter(x=>x.id!==m.blockId); } }
}
/* Cancel the booked occurrence.

   RECURRING: this SKIPS one occurrence — it moves to the next date in the pattern
   rather than ending the repeat, because "I can't make Tuesday" is not "stop
   meeting this person". Stopping the repeat is a separate, explicit act: set the
   pattern back to One-off in the schedule flow.

   ONE-OFF: strips the linked appointment + calendar block (via removeMeetingLinks)
   and clears the scheduling fields. Either way the meeting itself — person,
   talking points, notes — is untouched. Returns true if anything changed. */
function cancelMeetingSchedule(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m || !m.nextMeeting) return false;
  if(meetingIsRecurring(m)){
    const next=meetingNextDate(m.recur, m.nextMeeting.date);
    if(next){
      if(!confirm(`Skip the ${apptDateLabel(m.nextMeeting.date)} meeting with "${m.name}"?\n\nIt moves to ${apptDateLabel(next)} — the recurrence keeps going. To stop it repeating, set the pattern to One-off instead.`)) return false;
      scheduleMeeting(m, next, m.recur.time);   // reuses the same records: a skip leaves no trace
      return true;
    }
  }
  if(!confirm(`Cancel the scheduled meeting for "${m.name}"? This removes its appointment and time block. The meeting itself — talking points and notes — stays.`)) return false;
  removeMeetingLinks(m);
  m.nextMeeting=null; m.apptId=null; m.blockId=null;
  save(); return true;
}
function scheduleMeeting(m, date, time){
  // 1) Appointment — update the linked one in place, or create + link (if missing/deleted).
  let appt=m.apptId && (S.appointments||[]).find(a=>a.id===m.apptId);
  if(appt){ appt.title=m.name; appt.date=date; appt.time=time; }
  else { appt=createAppointment(m.name, date, time); m.apptId=appt.id; }
  // 2) Calendar block (kind:'project' task) — update/move the linked one, or create + link.
  const hour=meetingHour(time);
  const ref=m.blockId && findTaskGlobal(m.blockId);
  if(ref){
    const t=ref.t;
    if(ref.dayKey!==date){   // moved to a different day → relocate the SAME object (id preserved)
      S.days[ref.dayKey].tasks=(S.days[ref.dayKey].tasks||[]).filter(x=>x.id!==t.id);
      dayFor(date).tasks.push(t);
    }
    t.txt=m.name; t.schedDate=date; t.start=hour; t.done=false; t.meetingId=m.id;
    if(t.mins==null) t.mins=60;
  } else {
    const t={id:b(), txt:m.name, kind:'project', done:false, mins:60, start:hour, schedDate:date, meetingId:m.id};
    dayFor(date).tasks.push(t); m.blockId=t.id;
  }
  // 3) display marker on the meeting
  m.nextMeeting={date, time};
  save();
}
/* ---------- the schedule flow: one-off date+time, or a repeating pattern ----------
   One modal with a frequency row at the top. "One-off" is the original date+time
   picker, unchanged; the repeating options swap the date field for the part of the
   pattern that varies (a weekday, or a day of the month) and keep the time.
   Held in a draft object and re-rendered on every change, like the project-task
   scheduler, so switching frequency never loses the time you already typed. */
let mtgSchedDraft=null;   // {mid, freq, date, time, dow, dom}

function openMeetingSchedule(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m) return;
  meetingModalId=mid;
  const nm=m.nextMeeting||{}, r=m.recur||{};
  const seedDate=nm.date||todayKey();
  mtgSchedDraft={
    mid,
    freq: r.freq || 'once',
    date: seedDate,
    time: r.time || nm.time || '',
    // sensible defaults for the fields the current pattern doesn't carry, taken
    // from whatever is already booked so switching frequency starts somewhere real
    dow: (r.dow!=null) ? r.dow : dateFromKey(seedDate).getDay(),
    dom: (r.dom!=null) ? r.dom : dateFromKey(seedDate).getDate(),
  };
  renderMeetingSchedule();
}
function renderMeetingSchedule(){
  const d=mtgSchedDraft; if(!d) return;
  const m=(S.meetings||[]).find(x=>x.id===d.mid); if(!m){ closeReset(); return; }
  const wasRecurring=meetingIsRecurring(m);
  // live preview of what will actually be booked
  let preview='';
  if(d.freq==='once') preview = d.date&&d.time ? `${apptDateLabel(d.date)} · ${fmtClock(d.time)}` : 'Pick a date and time';
  else if(!d.time) preview='Pick a time';
  else {
    const first=meetingFirstDate({freq:d.freq, time:d.time, dow:d.dow, dom:d.dom});
    preview = first ? `First: ${apptDateLabel(first)} · ${fmtClock(d.time)}` : 'No date matches that pattern';
  }
  const el=q('#resetModal');
  el.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="msClose">×</span>
      <h3>${m.nextMeeting?'Reschedule':'Schedule'} — ${esc(m.name)}</h3>
      <p class="intro">This books a real appointment and blocks it on your Time Blocker, so it shows on the calendar, in ☀ Today and in your reminders.</p>

      <div class="qf"><label>Repeats</label>
        <div class="ms-freq">
          ${MTG_FREQS.map(([k,lbl])=>`<button class="ms-freq-btn ${d.freq===k?'sel':''}" data-msfreq="${k}">${lbl}</button>`).join('')}
        </div>
      </div>

      ${d.freq==='once'?`
        <div class="qf"><label>Date</label>
          <input type="date" id="msDate" min="${todayKey()}" value="${esc(d.date)}"></div>`:''}

      ${(d.freq==='weekly'||d.freq==='biweekly')?`
        <div class="qf"><label>Day</label>
          <div class="ms-dow">
            ${MTG_DOW.map((n,i)=>`<button class="ms-dow-btn ${d.dow===i?'sel':''}" data-msdow="${i}" title="${n}">${n.slice(0,3)}</button>`).join('')}
          </div></div>`:''}

      ${d.freq==='monthly'?`
        <div class="qf"><label>Day of the month</label>
          <input type="number" id="msDom" min="1" max="31" class="num-in" value="${d.dom||1}">
          <span class="hint" style="margin-left:8px">A day past the end of a short month lands on its last day.</span>
        </div>`:''}

      <div class="qf"><label>Time</label>
        <input type="time" id="msTime" value="${esc(d.time)}"></div>

      <div class="ms-preview">${esc(preview)}</div>

      ${d.freq!=='once'?`<p class="list-note">Only the next occurrence is ever booked. When it's done or the time passes, the one after it appears automatically.</p>`
        :(wasRecurring?`<p class="list-note">Switching to one-off stops the repeat. The meeting you already have booked stays exactly where it is.</p>`:'')}

      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="msSave">${m.nextMeeting?'Update':'Schedule'}</button>
        <button class="btn ghost" id="msCancel">Cancel</button>
      </div>
    </div>`;
  el.classList.add('show');
  bindMeetingSchedule();
}
function bindMeetingSchedule(){
  const d=mtgSchedDraft; if(!d) return;
  q('#msClose').onclick=()=>closeReset();
  q('#msCancel').onclick=()=>closeReset();
  // discrete choices re-render (to swap the fields + refresh the preview); the
  // free inputs only write to the draft, so typing never re-renders under you
  q('#resetModal [data-msfreq]','all').forEach(el=>el.onclick=()=>{ d.freq=el.dataset.msfreq; renderMeetingSchedule(); });
  q('#resetModal [data-msdow]','all').forEach(el=>el.onclick=()=>{ d.dow=+el.dataset.msdow; renderMeetingSchedule(); });
  const di=q('#msDate'); if(di) di.onchange=()=>{ d.date=di.value||todayKey(); renderMeetingSchedule(); };
  const ti=q('#msTime'); if(ti) ti.onchange=()=>{ d.time=ti.value; renderMeetingSchedule(); };
  const dm=q('#msDom'); if(dm) dm.oninput=()=>{ const n=parseInt(dm.value,10); if(!isNaN(n)&&n>=1&&n<=31) d.dom=n; };
  q('#msSave').onclick=saveMeetingSchedule;
}
function saveMeetingSchedule(){
  const d=mtgSchedDraft; if(!d) return;
  const m=(S.meetings||[]).find(x=>x.id===d.mid); if(!m){ closeReset(); return; }
  const time=(q('#msTime')&&q('#msTime').value)||d.time;
  if(!time){ toast('Pick a time'); return; }
  d.time=time;
  if(d.freq==='once'){
    const date=(q('#msDate')&&q('#msDate').value)||d.date;
    if(!date){ toast('Pick a date'); return; }
    // clearing the pattern keeps the booking — it just stops repeating
    if(meetingIsRecurring(m)) setMeetingRecurrence(m, null);
    scheduleMeeting(m, date, time);
    closeReset(); toast('Meeting scheduled ✓'); rerender();
    return;
  }
  if(!setMeetingRecurrence(m, {freq:d.freq, time, dow:d.dow, dom:d.dom})){
    toast('No date matches that pattern'); return;
  }
  closeReset(); toast(`Repeating — ${meetingRecurLabel(m)}`); rerender();
}
