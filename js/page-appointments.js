/* ============================================================
   APPOINTMENTS — fixed commitments with a set date + time (meetings,
   calls, doctor…), distinct from tasks. Prominent on the Dashboard.
   Item: { id, title, date (YYYY-MM-DD), time (HH:MM), createdAt }
   ============================================================ */
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
/* "2026-06-23" → "June 23" (full month + day, for the prominent leading date) */
function apptDateFull(k){
  const [y,m,d]=k.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-CA',{month:'long',day:'numeric'});
}
/* has this appointment's date/time already PASSED? With a time, compare to the exact
   moment; with no time, only overdue once the whole day is over (end of day). */
function apptOverdue(a){
  if(!a || !a.date) return false;
  if(a.done) return false;   // done beats overdue — a completed appointment is never overdue
  const [y,m,d]=a.date.split('-').map(Number);
  let dt;
  if(a.time){ const [h,mn]=a.time.split(':').map(Number); dt=new Date(y,m-1,d,h||0,mn||0,0); }
  else { dt=new Date(y,m-1,d,23,59,59); }
  return dt.getTime() < Date.now();
}

/* ============================================================
   THE DASHBOARD APPOINTMENT WINDOW — one week, no further.
   The dashboard is for what's imminent; a long tail of future commitments is
   exactly the length that makes it unreadable. So the ☀ Today strip looks seven
   days ahead and stops.

   Nothing is hidden by this. Anything past the window is counted in a quiet
   "+N later" that opens the overlay, and the OVERLAY IS UNWINDOWED — List,
   Calendar and Archive all still show everything, which is where you go to see
   the full picture. Overdue appointments ignore the window entirely: a missed
   commitment must never scroll out of sight.
   ============================================================ */
const APPT_WINDOW_DAYS=7;
function apptWindowEndKey(){ return keyPlusDays(todayKey(), APPT_WINDOW_DAYS-1); }
/* active, not overdue, and past the window — the ones we only COUNT */
function apptBeyondWindow(){
  const end=apptWindowEndKey();
  return (S.appointments||[]).filter(a=>a && a.date && !a.done && !apptOverdue(a) && a.date>end);
}

/* TODAY — a lightweight glance strip pinned to the very top of the Dashboard:
   appointments within the window first, then today's scheduled + overdue tasks
   (compact, check-off only — no edit/schedule/delete). It's a "here's your day"
   overview; the full interactive task list stays below in All Tasks. Returns ''
   when there is genuinely nothing to say. Appointment delete reuses
   [data-apptdel]; the task check-off reuses [data-atcheck] — both already bound
   (bindAppointments / bindAllTasks). */
function renderTodayStrip(){
  const tk=todayKey();
  const winEnd=apptWindowEndKey();
  // appointments inside the seven-day window PLUS any overdue (past) ones —
  // overdue stay visible at the top so they aren't forgotten, surfaced before
  // what's still upcoming. Done appointments today still show (as "happened")
  // but sink to the bottom, muted.
  const later=apptBeyondWindow();
  const appts=(S.appointments||[]).filter(a=>a.date && (apptOverdue(a) || (a.date>=tk && a.date<=winEnd)))
    .sort((a,b)=>{
      if(!!a.done!==!!b.done) return a.done?1:-1;                  // completed sink to bottom
      const oa=apptOverdue(a), ob=apptOverdue(b);
      if(oa!==ob) return oa?-1:1;                                  // overdue surface first
      return (a.date+(a.time||'')).localeCompare(b.date+(b.time||''));   // then by soonest
    });
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
    tasks.push({ source:t.projectId?'project':'standalone', key, txt:t.txt, priority:!!t.priority,
                 start:t.start, schedDate:t.schedDate, overdue:false, projName, projColor });
  });
  tasks.sort((a,b)=>{   // overdue (older dates) first, then by start time
    const ka=(a.schedDate||'')+'|'+(a.start!=null?String(a.start).padStart(6,'0'):'zzzzzz');
    const kb=(b.schedDate||'')+'|'+(b.start!=null?String(b.start).padStart(6,'0'):'zzzzzz');
    return ka.localeCompare(kb);
  });
  // nothing in the window, no tasks, and nothing beyond it either → no card at all
  if(!appts.length && !tasks.length && !later.length) return '';
  const apptRow=(a)=>{ const od=apptOverdue(a); return `
    <div class="glance-row appt ${od?'overdue':''} ${a.done?'done':''}">
      <span class="appt-date-lead">${apptDateFull(a.date)}</span>
      <span class="glance-time">${fmtClock(a.time)||'—'}</span>
      <div class="box glance-box" data-apptdone="${a.id}" title="${a.done?'Mark not done':'Mark done'}">✓</div>
      <span class="glance-txt">${esc(a.title)}</span>
      ${od?`<span class="glance-od">Overdue</span>`:''}
      <span class="x" data-apptdel="${a.id}" title="Delete appointment">×</span>
    </div>`; };
  const taskRow=(r)=>{
    const label = r.source==='project'
      ? `<span class="proj-chip" style="--pc:${r.projColor}">${esc(r.projName)}</span>`
      : `<span class="type-chip s">▣ Time block</span>`;
    const time = r.start!=null?fmtHour(r.start):(r.overdue?'⚠':'—');
    return `
    <div class="glance-row task ${r.overdue?'overdue':''}">
      <span class="glance-time">${time}</span>
      <div class="box glance-box" data-atcheck="${r.key}" title="Mark done">✓</div>
      <span class="glance-txt">${r.priority?'<span class="prio-mark">🔥</span> ':''}${esc(r.txt)}</span>
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
    ${later.length?`<button class="glance-more" id="glanceMore" title="Open the full appointments view">+${later.length} later · beyond the next ${APPT_WINDOW_DAYS} days →</button>`:''}
  </div>`;
}

/* ---------- what the dashboard's Appointments hub card shows ----------
   The dashboard's appointment LIST is gone: today's appointments are already
   pinned in the ☀ Today strip above, and everything else — upcoming, calendar,
   archive — is in the overlay this card opens. What's left is one number.

   Overdue wins when there is any, because that's the state that needs you; it
   also turns the card red. Otherwise it's what's still coming, captioned with
   when the next one actually is.

   COMPLETED APPOINTMENTS ARE ARCHIVED, NEVER DELETED — a.done stays on the
   record and the overlay's Archive view renders exactly these; this only filters. */
function apptHubStat(){
  const active=(S.appointments||[]).filter(a=>a.date && !a.done);
  const overdue=active.filter(apptOverdue);
  const ahead=active.filter(a=>!apptOverdue(a))
    .sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  const next=ahead[0];
  return {
    id:'hubAppts', ic:'📅', name:'Appointments',
    color: overdue.length ? 'var(--red)' : 'var(--blue)',
    n: overdue.length || ahead.length,
    sub: overdue.length
      ? `overdue — follow up`
      : (next ? `next ${apptDateLabel(next.date)} · ${fmtClock(next.time)}` : 'nothing scheduled'),
  };
}

/* create an appointment and return it. Shared by the manual add-input and by
   meeting scheduling, so meetings reuse the exact appointment shape/flow. */
function createAppointment(title, date, time){
  if(!S.appointments) S.appointments=[];
  const appt={ id:b(), title, date, time, createdAt:Date.now() };
  S.appointments.push(appt);
  return appt;
}
/* THE single delete path for appointments, used by the card, the Today strip and
   every view of the overlay.
   removeMeetingLinks() deletes a meeting's appointment when you unschedule the
   meeting, but the reverse never held: deleting the appointment left m.apptId
   dangling, so the meeting kept advertising a "next meeting" that no longer existed.
   Clearing the link here fixes it once for every surface. */
function deleteAppointment(id){
  S.appointments=(S.appointments||[]).filter(x=>x.id!==id);
  (S.meetings||[]).forEach(m=>{ if(m && m.apptId===id){ m.apptId=null; m.nextMeeting=null; } });
  // same for a training session's linked appointment: deleting it from the calendar
  // clears the session's time rather than leaving a link to a record that's gone.
  // The session itself — and its task — are untouched; it's just no longer timed.
  // workoutByApptId knows where sessions live (a day holds a list of them), so the
  // shape stays owned by one module
  const ws=(typeof workoutByApptId==='function') ? workoutByApptId(id) : null;
  if(ws){ ws.apptId=null; ws.time=null; }
  save();
}
/* Complete ⇄ reopen. Completing ARCHIVES (the record stays; the main list filters
   it out), so this is fully reversible. */
function toggleApptDone(id){
  const a=(S.appointments||[]).find(x=>x.id===id);
  if(!a) return null;
  a.done=!a.done;
  syncWorkoutFromAppt(a);   // a training session completes with its appointment too
  syncMeetingBlockFromAppt(a);   // …and a meeting's calendar block does the same
  // Ticking a meeting's appointment FINISHES that occurrence: it is snapshotted
  // into the meeting's log, and a recurring meeting rolls straight on to the next
  // one. The completed appointment and block stay put as the record that this one
  // happened — advanceMeetingRecurrence releases them and books fresh ones.
  // Un-ticking never finishes anything: that's a correction, not a completion.
  if(a.done && typeof finishMeetingOccurrence==='function'){
    const m=(S.meetings||[]).find(x=>x && x.apptId===a.id);
    if(m) finishMeetingOccurrence(m, a.date);
  }
  save();
  return a;
}

/* Row actions for appointments rendered inside #main — now just the ☀ Today strip,
   which carries a ✓ and a × per appointment. Adding lives in unified Capture at
   the top of the Dashboard (capture.js), which calls createAppointment(); meeting
   scheduling calls it too. Everything else lives in the overlay. */
function bindAppointments(){
  q('[data-apptdel]','all').forEach(el=>el.onclick=()=>{ deleteAppointment(el.dataset.apptdel); rerender(); });
  q('[data-apptdone]','all').forEach(el=>el.onclick=()=>{ toggleApptDone(el.dataset.apptdone); rerender(); });
  // "+N later" — the window's escape hatch, straight into the unwindowed list
  const gm=q('#glanceMore'); if(gm) gm.onclick=()=>openApptScreen('list');
}

/* ============================================================
   THE APPOINTMENTS OVERLAY — List · Calendar · Archive.
   One host (#apptScreen) with three toggleable views rather than separate
   overlays, so the archive is a peer view instead of a dead end. Reuses the
   .pick-screen component (shell, header, density classes, body.pick-open) and
   lives OUTSIDE .app, so the rerender() that refreshes the dashboard behind it
   can never disturb it.

   All three views read S.appointments DIRECTLY — no copies, no derived store —
   and share one detail panel and one set of handlers, so "complete or delete
   from either view" is a single code path.
   ============================================================ */
let apptScreenOpen=false;
let apptView='list';          // 'list' | 'calendar' | 'archive'
let apptOpenId=null;          // which appointment's detail is showing (null = the view)
let apptMonth=null;           // {y,m} displayed month; null = the current one

const APPT_VIEWS=[['list','List'],['calendar','Calendar'],['archive','Archive']];

function openApptScreen(view){
  apptScreenOpen=true;
  apptView=view||'list';
  apptOpenId=null; apptMonth=null;
  paintApptScreen();
}
function closeApptScreen(){ apptScreenOpen=false; paintApptScreen(); rerender(); }
function apptById(id){ return (S.appointments||[]).find(a=>a.id===id)||null; }

/* group a list into one .pick-group per date */
function apptDateGroups(list, desc){
  const by={};
  list.forEach(a=>{ if(a && a.date) (by[a.date]=by[a.date]||[]).push(a); });
  return Object.keys(by).sort((x,y)=>desc?y.localeCompare(x):x.localeCompare(y)).map(k=>({
    key:k,
    title:apptDateLabel(k),
    color: k===todayKey() ? 'var(--accent)' : (k<todayKey() ? 'var(--red)' : 'var(--txt-dim)'),
    items:by[k].sort((a,b)=>(a.time||'').localeCompare(b.time||'')),
  }));
}
/* one compact single-line row — the same .pick-row base as every other overlay */
function apptRowHTML(a){
  const od=apptOverdue(a);
  return `<div class="pick-row has-actions ${a.done?'is-done':''} ${od?'is-od':''}">
    <span class="pick-check" data-asdone="${a.id}" title="${a.done?'Reopen — back to the active list':'Complete — move to the archive'}">✓</span>
    <span class="appt-r-time">${fmtClock(a.time)||'—'}</span>
    <span class="pick-txt" data-asopen="${a.id}" title="Open">${esc(a.title)}</span>
    <span class="x" data-asdel="${a.id}" title="Delete">×</span>
  </div>`;
}
function apptGroupHTML(g){
  return `<section class="pick-group" style="--gc:${g.color}">
    <h3 class="pick-g-title">${esc(g.title)}<span class="pick-g-ct">${g.items.length}</span></h3>
    <div class="pick-rows">${g.items.map(apptRowHTML).join('')}</div>
  </section>`;
}

/* ---------- CALENDAR ---------- */
function apptDisplayMonth(){
  if(apptMonth) return apptMonth;
  const d=new Date(); return {y:d.getFullYear(), m:d.getMonth()};
}
function apptMonthShift(delta){
  const cur=apptDisplayMonth();
  const d=new Date(cur.y, cur.m+delta, 1);
  apptMonth={y:d.getFullYear(), m:d.getMonth()};
}
function apptDayKey(y,m,d){ return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }

function apptCalendarHTML(){
  const {y,m}=apptDisplayMonth();
  const tk=todayKey();
  const first=new Date(y,m,1);
  const startDow=(first.getDay()+6)%7;              // Monday-first
  const days=new Date(y,m+1,0).getDate();
  const weeks=Math.ceil((startDow+days)/7);         // 4–6: the rows this month actually spans
  const byDate={};
  (S.appointments||[]).forEach(a=>{ if(a&&a.date) (byDate[a.date]=byDate[a.date]||[]).push(a); });
  const monthLabel=first.toLocaleDateString('en-CA',{month:'long',year:'numeric'});

  let cells='';
  const total=weeks*7;
  for(let i=0;i<total;i++){
    const dayNum=i-startDow+1;
    const inMonth=dayNum>=1 && dayNum<=days;
    const dt=new Date(y,m,dayNum);                  // JS rolls over for the outside days
    const key=apptDayKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const list=(byDate[key]||[]).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const chips=list.map(a=>`<button class="cal-chip ${a.done?'done':''} ${apptOverdue(a)?'od':''}" data-asopen="${a.id}" title="${esc(a.title)}">
        <span class="cal-ct">${fmtClock(a.time)||'—'}</span><span class="cal-cx">${esc(a.title)}</span>
      </button>`).join('');
    cells+=`<div class="cal-cell ${inMonth?'':'outside'} ${key===tk?'is-today':''}">
      <span class="cal-d">${dt.getDate()}</span>
      <div class="cal-chips">${chips}</div>
    </div>`;
  }
  return `
  <div class="cal-wrap">
    <div class="cal-nav">
      <button class="btn ghost sm" id="calPrev" title="Previous month">‹</button>
      <span class="cal-month">${esc(monthLabel)}</span>
      <button class="btn ghost sm" id="calNext" title="Next month">›</button>
      <button class="btn ghost sm" id="calToday">Today</button>
    </div>
    <div class="cal-dows">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div>
    <div class="cal-grid" style="--rows:${weeks}">${cells}</div>
  </div>`;
}

/* ---------- DETAIL (replaces the view body, never expands inline) ---------- */
function apptDetailHTML(a){
  const od=apptOverdue(a);
  const linked=(S.meetings||[]).find(m=>m && m.apptId===a.id);
  return `<div class="appt-detail">
    <button class="pick-back" id="apptBack">← All appointments</button>
    <div class="qf"><label>Title</label>
      <input type="text" data-astitle="${a.id}" value="${esc(a.title||'')}" placeholder="What is it?"></div>
    <div class="appt-d-when">
      <div class="qf"><label>Date</label><input type="date" data-asdate="${a.id}" value="${esc(a.date||'')}"></div>
      <div class="qf"><label>Time</label><input type="time" data-astime="${a.id}" value="${esc(a.time||'')}"></div>
    </div>
    <div class="appt-d-meta">
      ${a.done?'<span class="appt-d-tag done">✓ Archived</span>':''}
      ${od?'<span class="appt-d-tag od">⚠ Overdue</span>':''}
      ${linked?`<span class="appt-d-tag link">📅 Linked to the meeting “${esc(linked.name)}”</span>`:''}
    </div>
    <div class="appt-d-actions">
      <button class="btn" data-asdone="${a.id}">${a.done?'↩ Reopen':'✓ Complete'}</button>
      <button class="btn ghost sm" data-asdel="${a.id}">Delete</button>
    </div>
  </div>`;
}

function apptScreenHTML(){
  const all=(S.appointments||[]).filter(a=>a.date);
  const active=all.filter(a=>!a.done), archived=all.filter(a=>a.done);
  const cur=apptOpenId ? apptById(apptOpenId) : null;
  const tab=([k,lbl])=>`<button class="pick-tab ${apptView===k?'on':''}" data-asview="${k}">${lbl}${k==='archive'&&archived.length?` (${archived.length})`:''}</button>`;
  let body;
  if(cur){ body=apptDetailHTML(cur); }
  else if(apptView==='calendar'){ body=apptCalendarHTML(); }
  else if(apptView==='archive'){
    const g=apptDateGroups(archived, true);   // most recent first
    body = g.length
      ? `<div class="pick-body">${g.map(apptGroupHTML).join('')}</div>`
      : `<div class="empty">Nothing archived yet. Completed appointments land here.</div>`;
  }else{
    const g=apptDateGroups(active, false);    // date order
    body = g.length
      ? `<div class="pick-body">${g.map(apptGroupHTML).join('')}</div>`
      : `<div class="empty">No upcoming appointments.</div>`;
  }
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>📅 Appointments</h2>
        <p>Fixed commitments. Completing one archives it — nothing is ever deleted by completing.</p></div>
      <div class="pick-tabs">${APPT_VIEWS.map(tab).join('')}</div>
      <button class="pick-close" id="apptScreenClose" title="Close">×</button>
    </header>
    ${body}
  </div>`;
}

/* The calendar needs its OWN fitting pass. fitPickScreen() steps density down for
   multi-column text flow, which is the wrong model for a fixed 7×N grid: the grid
   already fills the viewport exactly (rows are minmax(0,1fr)), so it can never
   scroll — overflow is a per-CELL problem. This hides the chips that don't fit and
   appends a "+N" marker, accounting for the marker's own height. */
function fitApptCalendar(root){
  if(!root) return;
  root.querySelectorAll('.cal-chips').forEach(box=>{
    const old=box.querySelector('.cal-more'); if(old) old.remove();
    const chips=[...box.querySelectorAll('.cal-chip')];
    chips.forEach(c=>{ c.style.display=''; });
    if(box.scrollHeight<=box.clientHeight) return;
    let hidden=0;
    while(hidden<chips.length && box.scrollHeight>box.clientHeight){
      chips[chips.length-1-hidden].style.display='none';
      hidden++;
    }
    if(!hidden) return;
    const more=document.createElement('span');
    more.className='cal-more'; more.textContent='+'+hidden;
    box.appendChild(more);
    while(hidden<chips.length && box.scrollHeight>box.clientHeight){   // the marker itself takes a line
      chips[chips.length-1-hidden].style.display='none';
      hidden++; more.textContent='+'+hidden;
    }
  });
}

function paintApptScreen(){
  const el=q('#apptScreen'); if(!el) return;
  if(!apptScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=apptScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindApptScreen();
  if(apptOpenId) return;                       // the detail is a single column; nothing to fit
  if(apptView==='calendar') fitApptCalendar(el);
  else fitPickScreen(el);                      // List + Archive are the multi-column case
}

function bindApptScreen(){
  const cl=q('#apptScreenClose'); if(cl) cl.onclick=closeApptScreen;
  const bk=q('#apptBack'); if(bk) bk.onclick=()=>{ apptOpenId=null; paintApptScreen(); };
  q('#apptScreen [data-asview]','all').forEach(el=>el.onclick=()=>{ apptView=el.dataset.asview; apptOpenId=null; paintApptScreen(); });

  // open a detail — from a list row or a calendar chip, same handler
  q('#apptScreen [data-asopen]','all').forEach(el=>el.onclick=()=>{ apptOpenId=el.dataset.asopen; paintApptScreen(); });

  // complete / reopen and delete — the SAME mutators the dashboard card uses, so
  // every surface stays in step. rerender() refreshes the dashboard behind us.
  q('#apptScreen [data-asdone]','all').forEach(el=>el.onclick=()=>{
    const a=toggleApptDone(el.dataset.asdone);
    if(a && a.done && apptOpenId===a.id) apptOpenId=null;   // archived → back to the list
    paintApptScreen(); rerender();
    if(a) toast(a.done?'Archived ✓':'Back on the list');
  });
  q('#apptScreen [data-asdel]','all').forEach(el=>el.onclick=()=>{
    const a=apptById(el.dataset.asdel); if(!a) return;
    if(!confirm(`Delete "${a.title}"? This removes it for good — completing archives it instead.`)) return;
    deleteAppointment(a.id);
    if(apptOpenId===a.id) apptOpenId=null;
    paintApptScreen(); rerender();
  });

  // detail fields — text saves WITHOUT repainting so the caret never jumps;
  // date/time are discrete, so they repaint to re-sort and re-group
  const ti=q('#apptScreen [data-astitle]');
  if(ti) ti.oninput=()=>{ const a=apptById(ti.dataset.astitle); if(a){ a.title=ti.value; save(false); } };
  const di=q('#apptScreen [data-asdate]');
  if(di) di.onchange=()=>{ const a=apptById(di.dataset.asdate); if(a){ a.date=di.value; save(); paintApptScreen(); rerender(); } };
  const tmi=q('#apptScreen [data-astime]');
  if(tmi) tmi.onchange=()=>{ const a=apptById(tmi.dataset.astime); if(a){ a.time=tmi.value; save(); paintApptScreen(); rerender(); } };

  // month navigation
  const pv=q('#calPrev'); if(pv) pv.onclick=()=>{ apptMonthShift(-1); paintApptScreen(); };
  const nx=q('#calNext'); if(nx) nx.onclick=()=>{ apptMonthShift(1); paintApptScreen(); };
  const td=q('#calToday'); if(td) td.onclick=()=>{ apptMonth=null; paintApptScreen(); };
}
