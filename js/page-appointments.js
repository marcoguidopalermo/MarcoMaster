/* ============================================================
   APPOINTMENTS — fixed commitments with a set date + time (meetings,
   calls, doctor…), distinct from tasks. Prominent on the Dashboard.
   Item: { id, title, date (YYYY-MM-DD), time (HH:MM), createdAt }
   ============================================================ */
let apptDraft={title:'',date:todayKey(),time:''};

/* "14:00" → "2:00pm" */
function fmtClock(hhmm){
  if(!hhmm) return '';
  const [h,m]=String(hhmm).split(':').map(Number);
  const ampm=h>=12?'pm':'am'; let disp=h%12; if(disp===0) disp=12;
  return disp+':'+String(m||0).padStart(2,'0')+ampm;
}
/* "2026-06-05" → "Thu Jun 5" */
function apptDateLabel(k){
  const [y,m,d]=k.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
}

/* TODAY — a lightweight glance strip pinned to the very top of the Dashboard:
   today's appointments first, then today's scheduled + overdue tasks (compact,
   check-off only — no edit/schedule/delete). It's a "here's your day" overview;
   the full interactive task list stays below in All Tasks. Returns '' when there
   is nothing today. Appointment delete reuses [data-apptdel]; the task check-off
   reuses [data-atcheck] — both already bound (bindAppointments / bindAllTasks). */
function renderTodayStrip(){
  const tk=todayKey();
  const appts=(S.appointments||[]).filter(a=>a.date===tk).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  // today's + overdue scheduled tasks (not done). Two sources, deduped by a
  // canonical key so each task shows once:
  //   1) the unified rows (covers OVERDUE past-due tasks + project tasks);
  //   2) scheduledOn(today) — the EXACT source the Time Blocker grid renders, so
  //      any task with a block on today's calendar appears even if its task
  //      object lives in another day record (which #1 wouldn't surface).
  const {scheduled}=buildTaskRows();
  const tasks=scheduled.filter(r=>!r.done && r.schedDate!=null && r.schedDate<=tk);
  const seen=new Set(tasks.map(r=>r.key));
  scheduledOn(tk).forEach(e=>{
    const t=e.t; if(t.meetingId) return;   // meetings show as appointments, not tasks
    const key=t.projectId ? ('P|'+t.projectId+'|'+t.projTaskId) : ('S|'+t.id);
    if(seen.has(key)) return;
    seen.add(key);
    let projName=null, projColor=null;
    if(t.projectId){ const p=(S.projects||[]).find(x=>x.id===t.projectId); if(p){ projName=p.name; projColor=p.color; } }
    tasks.push({ source:t.projectId?'project':'standalone', key, txt:t.txt,
                 start:t.start, schedDate:t.schedDate, overdue:false, projName, projColor });
  });
  tasks.sort((a,b)=>{   // overdue (older dates) first, then by start time
    const ka=(a.schedDate||'')+'|'+(a.start!=null?String(a.start).padStart(6,'0'):'zzzzzz');
    const kb=(b.schedDate||'')+'|'+(b.start!=null?String(b.start).padStart(6,'0'):'zzzzzz');
    return ka.localeCompare(kb);
  });
  if(!appts.length && !tasks.length) return '';
  const apptRow=(a)=>`
    <div class="glance-row appt">
      <span class="glance-time">${fmtClock(a.time)||'—'}</span>
      <span class="glance-ic">📅</span>
      <span class="glance-txt">${esc(a.title)}</span>
      <span class="x" data-apptdel="${a.id}" title="Delete appointment">×</span>
    </div>`;
  const taskRow=(r)=>{
    const label = r.source==='project'
      ? `<span class="proj-chip" style="--pc:${r.projColor}">${esc(r.projName)}</span>`
      : `<span class="type-chip s">▣ Time block</span>`;
    const time = r.start!=null?fmtHour(r.start):(r.overdue?'⚠':'—');
    return `
    <div class="glance-row task ${r.overdue?'overdue':''}">
      <span class="glance-time">${time}</span>
      <div class="box glance-box" data-atcheck="${r.key}" title="Mark done">✓</div>
      <span class="glance-txt">${esc(r.txt)}</span>
      ${label}
      ${r.overdue?`<span class="glance-od">overdue</span>`:''}
    </div>`;
  };
  return `
  <div class="card today-strip">
    <div class="card-h"><h3>☀ Today</h3><span class="sub">${appts.length?appts.length+' appt'+(appts.length>1?'s':'')+' · ':''}${tasks.length} task${tasks.length===1?'':'s'}</span></div>
    <div class="glance-list">
      ${appts.map(apptRow).join('')}
      ${tasks.map(taskRow).join('')}
    </div>
  </div>`;
}

function renderAppointments(){
  const tk=todayKey();
  const all=(S.appointments||[]).filter(a=>a.date && a.date>=tk);   // past drop off
  const today=all.filter(a=>a.date===tk).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const upcoming=all.filter(a=>a.date>tk).sort((a,b)=>((a.date+(a.time||''))).localeCompare(b.date+(b.time||'')));
  const row=(a)=>`
    <div class="appt-row ${a.date===tk?'today':''}">
      <span class="appt-time">${fmtClock(a.time)}</span>
      <span class="appt-title">${esc(a.title)}</span>
      <span class="appt-date">${a.date===tk?'Today':apptDateLabel(a.date)}</span>
      <span class="x" data-apptdel="${a.id}">×</span>
    </div>`;
  return `
  <div class="card appt-card">
    <div class="card-h"><h3>📅 Appointments</h3><span class="sub">${today.length?today.length+' today · ':''}${upcoming.length} upcoming</span></div>

    <div class="appt-add">
      <input type="text" id="apptTitle" value="${esc(apptDraft.title)}" placeholder="Appointment (e.g. Dentist)…">
      <input type="date" id="apptDate" min="${tk}" value="${esc(apptDraft.date||tk)}">
      <input type="time" id="apptTime" value="${esc(apptDraft.time)}">
      <button class="btn" id="apptAdd">Add</button>
    </div>

    ${today.length?`<p class="list-note" style="margin:4px 0 10px">Today's ${today.length} appointment${today.length>1?'s are':' is'} pinned to the top of the Dashboard.</p>`:''}

    ${upcoming.length?`
      <div class="appt-group-lbl">Upcoming</div>
      <div class="appt-list">${upcoming.map(row).join('')}</div>`:''}

    ${(!today.length && !upcoming.length)?'<div class="empty">No appointments scheduled.</div>':''}
  </div>`;
}

/* create an appointment and return it. Shared by the manual add-input and by
   meeting scheduling, so meetings reuse the exact appointment shape/flow. */
function createAppointment(title, date, time){
  if(!S.appointments) S.appointments=[];
  const appt={ id:b(), title, date, time, createdAt:Date.now() };
  S.appointments.push(appt);
  return appt;
}
function bindAppointments(){
  const ti=q('#apptTitle'); if(ti) ti.oninput=()=>{ apptDraft.title=ti.value; };
  const di=q('#apptDate'); if(di) di.oninput=()=>{ apptDraft.date=di.value; };
  const tmi=q('#apptTime'); if(tmi) tmi.oninput=()=>{ apptDraft.time=tmi.value; };
  const addAppt=()=>{
    const title=(apptDraft.title||'').trim();
    const date=apptDraft.date||'';
    const time=apptDraft.time||'';
    if(!title){ toast('Add a title'); return; }
    if(!date || !time){ toast('Pick a date and time'); return; }
    createAppointment(title, date, time);
    apptDraft={title:'',date:todayKey(),time:''};
    save(); toast('Appointment added'); rerender();
  };
  const ab=q('#apptAdd'); if(ab) ab.onclick=addAppt;
  if(ti) ti.onkeydown=e=>{ if(e.key==='Enter') addAppt(); };
  q('[data-apptdel]','all').forEach(el=>el.onclick=()=>{ S.appointments=(S.appointments||[]).filter(x=>x.id!==el.dataset.apptdel); save(); rerender(); });
}
