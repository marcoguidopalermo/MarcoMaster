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

    ${today.length?`
      <div class="appt-group-lbl today">Today</div>
      <div class="appt-list">${today.map(row).join('')}</div>`:''}

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
