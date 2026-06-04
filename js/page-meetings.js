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

      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)}</div>`:''}
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

  // add a meeting
  const ni=q('#newMeeting'); if(ni) ni.oninput=()=>{ newMeetingName=ni.value; };
  const add=q('#addMeeting'); if(add) add.onclick=()=>{ if(createMeeting(newMeetingName)){ newMeetingName=''; rerender(); } };
  if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addMeeting').click(); };
}
/* create a meeting from a name; returns true if created. Shared by the Meetings
   tab add-input and the Dashboard inline "+" so the logic lives in one place. */
function createMeeting(name){
  const v=(name||'').trim(); if(!v) return false;
  if(!S.meetings) S.meetings=[];
  S.meetings.push({id:b(), name:v, points:[], notes:'', createdAt:Date.now(), nextMeeting:null, apptId:null, blockId:null});
  save(); return true;
}

function addMeetingPoint(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m) return;
  const v=(meetingDraftText[mid]||'').trim(); if(!v) return;
  if(!m.points) m.points=[];
  m.points.push({id:b(), txt:v, done:false});
  meetingDraftText[mid]=''; save(); rerender();
}

/* ============================================================
   DASHBOARD — at-a-glance Meetings strip, mirroring Active Projects.
   Each meeting is a compact card (name + talking-point progress); tap
   opens a modal with the checkable points + notes. Full management
   stays on the Meetings tab. Reuses the project-card-mini visual +
   the project-modal pattern, on the meetings data.
   ============================================================ */
function renderDashMeetings(){
  const meetings=S.meetings||[];
  return `
  <div class="card dash-projects">
    <div class="card-h"><h3>Meetings</h3><span class="ch-actions"><span class="sub">${meetings.length}</span><button class="dash-add-btn" id="dashAddMtg" title="Add a meeting">+</button></span></div>
    ${meetings.length?`<div class="proj-strip">
      ${meetings.map(m=>{ const s=meetingStats(m); const pct=s.total?Math.round(s.done/s.total*100):0; return `
        <button class="proj-card-mini" data-mtgopen="${m.id}">
          <span class="pcm-top"><span class="proj-swatch" style="background:var(--accent)"></span><span class="pcm-name">${esc(m.name)}</span></span>
          <div class="proj-track"><div class="proj-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <span class="pcm-count">${s.done}/${s.total} covered</span>
          ${m.nextMeeting?`<span class="pcm-next">${meetingNextLabel(m)}</span>`:''}
        </button>`; }).join('')}
    </div>`:'<div class="empty sm">No meetings — add one in the Meetings tab.</div>'}
  </div>`;
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
      ${m.nextMeeting?`<div class="mtg-next">📅 ${meetingNextLabel(m)}</div>`:''}
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
      <div class="mtg-section-lbl">Notes</div>
      <textarea class="mtg-notes" id="mmNotes" placeholder="Open notes / context for ${esc(m.name)}…">${esc(m.notes||'')}</textarea>
      <p class="list-note" style="margin-top:10px">Quick view · full management on the Meetings tab</p>
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
  const addP=()=>{ const v=(meetingModalDraft||'').trim(); if(!v) return; if(!m.points) m.points=[]; m.points.push({id:b(),txt:v,done:false}); meetingModalDraft=''; save(); renderMeetingModal(); rerender(); };
  const ab=q('#mmAddBtn'); if(ab) ab.onclick=addP;
  if(ai) ai.onkeydown=e=>{ if(e.key==='Enter') addP(); };
  const nt=q('#mmNotes'); if(nt) nt.oninput=()=>{ m.notes=nt.value; save(); };   // autosave; no re-render (keep caret)
  const sc=q('#mmSched'); if(sc) sc.onclick=()=>openMeetingSchedule(meetingModalId);
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
