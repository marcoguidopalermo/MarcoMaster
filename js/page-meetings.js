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

      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)} <span class="mtg-cancel" data-mcancel="${m.id}" title="Cancel this scheduled meeting">×</span></div>`:''}
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
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m) return false;
  const v=(txt||'').trim(); if(!v) return false;
  if(!m.points) m.points=[];
  m.points.push({id:b(), txt:v, done:false});
  save();
  return true;
}
function addMeetingPoint(mid){
  if(!createMeetingPoint(mid, meetingDraftText[mid])) return;
  meetingDraftText[mid]=''; rerender();
}

/* ============================================================
   DASHBOARD — a SHORT Meetings summary, mirroring Active Projects.
   Only what's live shows here (see mtgLive): something scheduled, or talking
   points waiting to be raised. Everything else — and the full survey — lives in
   the overlay, which the section header opens. Each card is still the same
   .proj-card-mini, and still opens the same modal.
   ============================================================ */
const MTG_DASH_MAX=4;   // beyond this the strip would scroll again — the overlay's job

function mtgOpenPoints(m){ return (m.points||[]).filter(p=>!p.done).length; }
/* live = scheduled, or points waiting. A meeting with neither is quiet: nothing
   is owed to it today, so it steps aside into the overlay. */
function mtgLive(m){ return !!(m.nextMeeting && m.nextMeeting.date) || mtgOpenPoints(m)>0; }
/* soonest first, then most points waiting — the same "what's most pressing"
   ordering the overlay groups express */
function mtgDashSort(a,b){
  const da=(a.nextMeeting&&a.nextMeeting.date)||'', db=(b.nextMeeting&&b.nextMeeting.date)||'';
  if(da&&db&&da!==db) return da.localeCompare(db);
  if(da!==db) return da?-1:1;
  return mtgOpenPoints(b)-mtgOpenPoints(a);
}

/* the compact card — unchanged markup, pulled out of the summary so the filtering
   above it stays readable */
function mtgMiniCardHTML(m){
  const s=meetingStats(m); const pct=s.total?Math.round(s.done/s.total*100):0;
  return `
    <button class="proj-card-mini" data-mtgopen="${m.id}">
      <span class="pcm-top"><span class="proj-swatch" style="background:var(--accent)"></span><span class="pcm-name">${esc(m.name)}</span></span>
      <div class="proj-track"><div class="proj-fill" style="width:${pct}%;background:var(--accent)"></div></div>
      <span class="pcm-count">${s.done}/${s.total} covered</span>
      ${m.nextMeeting?`<span class="pcm-next">${meetingNextLabel(m)} <span class="pcm-cancel" data-mcancel="${m.id}" title="Cancel this scheduled meeting">×</span></span>`:''}
    </button>`;
}
function renderDashMeetings(){
  const meetings=S.meetings||[];
  const live=meetings.filter(mtgLive).sort(mtgDashSort);
  const shown=live.slice(0, MTG_DASH_MAX);
  const more=meetings.length-shown.length;
  const sched=live.filter(m=>m.nextMeeting&&m.nextMeeting.date).length;
  const waiting=live.reduce((n,m)=>n+mtgOpenPoints(m),0);
  return `
  <div class="card dash-projects">
    <div class="card-h">
      <button class="sec-open-h" id="mtgOpenAll" title="Open the full meetings view">Meetings <span class="sec-open-go">›</span></button>
      <span class="ch-actions">
        <span class="sub">${sched?sched+' scheduled · ':''}${waiting?waiting+' point'+(waiting===1?'':'s')+' waiting':meetings.length+' total'}</span>
        <button class="dash-add-btn" id="dashAddMtg" title="Add a meeting">+</button>
      </span>
    </div>
    ${shown.length?`<div class="proj-strip">${shown.map(mtgMiniCardHTML).join('')}</div>`:`
      <div class="empty sm">${meetings.length
        ? 'Nothing scheduled and no points waiting.'
        : 'No meetings yet — add one with +.'}</div>`}
    ${more>0?`<button class="sec-more" id="mtgSeeAll">See all ${meetings.length} meetings →</button>`:''}
  </div>`;
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
  return `<button class="pick-row" data-mtgrow="${m.id}" title="Open ${esc(m.name)}">
    <span class="proj-swatch" style="background:var(--accent)"></span>
    <span class="pick-txt">${esc(m.name)}</span>
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
function openMeetingModal(mid){ meetingModalId=mid; meetingModalDraft=''; renderMeetingModal(); }
function renderMeetingModal(){
  const m=(S.meetings||[]).find(x=>x.id===meetingModalId); if(!m){ closeReset(); return; }
  const pts=m.points||[];
  const el=q('#resetModal');
  el.innerHTML=`
    <div class="modal modal-lg">
      <span class="modal-close" id="mmClose">×</span>
      <h3><span class="proj-swatch" style="background:var(--accent);display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(m.name)}</h3>
      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)} <span class="mtg-cancel" data-mcancel="${m.id}" title="Cancel this scheduled meeting">×</span></div>`:''}
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
      <textarea class="mtg-notes" id="mmNotes" placeholder="Open notes / context for ${esc(m.name)}…">${esc(m.notes||'')}</textarea>
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
/* remove the appointment + calendar block linked to a meeting (used on delete) */
function removeMeetingLinks(m){
  if(m.apptId){ S.appointments=(S.appointments||[]).filter(a=>a.id!==m.apptId); }
  if(m.blockId){ const ref=findTaskGlobal(m.blockId); if(ref){ S.days[ref.dayKey].tasks=(S.days[ref.dayKey].tasks||[]).filter(x=>x.id!==m.blockId); } }
}
/* cancel a scheduled next-meeting: strip the linked appointment + calendar block
   (via removeMeetingLinks) and clear the scheduling fields. The meeting itself —
   person, talking points, notes — is untouched. Returns true if cancelled. */
function cancelMeetingSchedule(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m || !m.nextMeeting) return false;
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
/* date+time picker modal; Save upserts via scheduleMeeting */
function openMeetingSchedule(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m) return;
  meetingModalId=mid;
  const nm=m.nextMeeting||{};
  const dateVal=nm.date||todayKey();
  const timeVal=nm.time||'';
  const el=q('#resetModal');
  el.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="msClose">×</span>
      <h3>${m.nextMeeting?'Reschedule':'Schedule next'} meeting</h3>
      <p class="intro">Pick a date and time for "${esc(m.name)}". This adds it to Appointments and blocks it on your Time Blocker.</p>
      <div class="ms-fields">
        <input type="date" id="msDate" min="${todayKey()}" value="${esc(dateVal)}">
        <input type="time" id="msTime" value="${esc(timeVal)}">
      </div>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="msSave">${m.nextMeeting?'Update':'Schedule'}</button>
        <button class="btn ghost" id="msCancel">Cancel</button>
      </div>
    </div>`;
  el.classList.add('show');
  q('#msClose').onclick=()=>closeReset();
  q('#msCancel').onclick=()=>closeReset();
  q('#msSave').onclick=()=>{
    const d=q('#msDate').value, t=q('#msTime').value;
    if(!d||!t){ toast('Pick a date and time'); return; }
    scheduleMeeting(m, d, t);
    closeReset(); toast('Meeting scheduled ✓'); rerender();
  };
}
