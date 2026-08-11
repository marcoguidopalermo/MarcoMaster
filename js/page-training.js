/* ============================================================
   TRAINING — plan the workout, show up, log it, build evidence.

   Deliberately simple. No sets, no weights, no reps-per-set, no distances,
   timers, exercise instructions, progressive overload or analytics. The whole
   module is three moves: maintain a library of exercise NAMES (Settings), build
   a week of sessions (this tab), and complete them through the normal task path.

   Store: S.training — see seedDefaults() in state.js for the shape.
     library : {category: [{id,name}]}          — names only, always
     floor   : the weekly FLOOR, never a target (Settings → Weekly floors)
     days    : {'YYYY-MM-DD': {rest, sessions:[session]}}

   A DAY HOLDS SESSIONS. A lift in the morning and a run in the evening are two
   sessions on one day, each with its own task, its own optional time (and so its
   own appointment), and its own completion. REST is a property of the DAY and
   means no sessions at all.

   Days are keyed by date rather than by weekday, so the weekly grid is just "the
   seven dates of the displayed week" and history comes for free: editing this
   week can never rewrite a week you already did.

   A planned session is a TASK (see syncWorkoutTask) and, when it has a time, also
   a linked APPOINTMENT (see syncWorkoutAppt) — exactly the way a scheduled meeting
   works. There is no separate completion surface: you complete the task, wherever
   you meet it, and the session follows.

   An exercise chosen into a session may carry ONE optional number — a bodyweight
   target like 100 pushups. It is a number that sits there and nothing else: not
   sets, not weight, not reps-per-set, never counted or tracked against. It lives
   on the SESSION's copy of the exercise, so writing 100 today never stamps 100
   onto every future pushup — the library stays names only.
   ============================================================ */

/* ---------- date helpers (local, matching todayKey()) ---------- */
function trainDayKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function trainDateFrom(dk){ const [y,m,d]=String(dk).split('-').map(Number); return new Date(y,m-1,d); }
/* Monday of the week containing dk */
function trainWeekStart(dk){ return weekStartKey(dk); }   // one shared definition (storage.js)
function trainWeekDates(mondayKey){
  const d=trainDateFrom(mondayKey), out=[];
  for(let i=0;i<7;i++){ const x=new Date(d); x.setDate(d.getDate()+i); out.push(trainDayKey(x)); }
  return out;
}
function trainWeekShift(mondayKey, delta){ const d=trainDateFrom(mondayKey); d.setDate(d.getDate()+delta*7); return trainDayKey(d); }
function trainWeekLabel(mondayKey){
  const days=trainWeekDates(mondayKey);
  const a=trainDateFrom(days[0]), z=trainDateFrom(days[6]);
  const opt={month:'short',day:'numeric'};
  const left=a.toLocaleDateString('en-CA',opt);
  const right=z.toLocaleDateString('en-CA', a.getMonth()===z.getMonth()?{day:'numeric'}:opt);
  return left+' – '+right;
}
const TRAIN_DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

/* ---------- accessors ---------- */
function trainLib(){ return (S.training&&S.training.library)||{}; }
function trainFloor(){ const f=+((S.training||{}).floor); return f>=1?f:3; }
function trainDays(){ return (S.training&&S.training.days)||{}; }
function trainDay(dk){ return trainDays()[dk]||null; }
function trainDaySessions(dk){ const d=trainDay(dk); return (d&&d.sessions)||[]; }
/* Rest is a whole-day state and means NO sessions — if a day somehow holds both,
   the sessions win (they carry links; the flag carries nothing). */
function trainIsRest(dk){ const d=trainDay(dk); return !!(d && d.rest && !(d.sessions||[]).length); }
function trainSessionAt(dk, sid){ return trainDaySessions(dk).find(s=>s.id===sid)||null; }
function trainEnsureDay(dk){
  if(!S.training.days) S.training.days={};
  if(!S.training.days[dk]) S.training.days[dk]={rest:false, sessions:[]};
  const d=S.training.days[dk];
  if(!Array.isArray(d.sessions)) d.sessions=[];
  return d;
}
/* every session in a date range, flattened — the basis of evidence and history */
function trainSessionsIn(dateKeys){
  const out=[];
  dateKeys.forEach(dk=>trainDaySessions(dk).forEach(s=>out.push(s)));
  return out;
}
function trainCatLabel(k){ const f=TRAIN_CATS.find(c=>c[0]===k); return f?f[1]:k; }
/* the one line a session shows everywhere — the task text, the appointment title */
function workoutTaskText(s){ return ((s&&s.title)||'').trim() || 'Training'; }
function workoutExLabel(s){
  const n=((s&&s.exercises)||[]).length;
  return n?`${n} exercise${n===1?'':'s'}`:'';
}
/* "Pushups · 100" when a target is set, "Pushups" when it isn't. The ONE place
   the optional number is formatted, so it can never render as "· null". */
function exDisplay(e){
  if(!e) return '';
  const n=e.target;
  return (n!=null && n!=='') ? `${e.name} · ${n}` : e.name;
}
/* a plain number or nothing. No units, no ranges, no expressions. */
function parseTarget(v){
  const n=parseInt(String(v==null?'':v).trim(),10);
  return (!isNaN(n) && n>0) ? n : null;
}

/* ============================================================
   SESSION TYPE — so the week can be read at a glance.
   Inferred, never stored: a session is CARDIO when its exercises are mostly from
   the Cardio/Run category OR its title names a cardio preset (a bare "Run", or
   "Morning run" — matched on a word boundary so "Runway" doesn't count). A rest
   DAY is its own type. Everything else is a workout.

   Colours come from the existing tokens and stay clear of the other systems:
   fire owns red and leaks own blue, so training uses green for a workout, amber
   for cardio, and a muted grey for rest.
   ============================================================ */
const TRAIN_CARDIO_PRESETS=['Run','Walk','Bike','Swim'];
const TRAIN_TYPES={
  workout:{label:'Workout', cls:'t-workout'},
  cardio: {label:'Cardio',  cls:'t-cardio'},
  rest:   {label:'Rest',    cls:'t-rest'},
};
function trainSessionType(s){
  if(!s) return 'workout';
  const ex=(s.exercises||[]);
  if(ex.length){
    const cardio=ex.filter(e=>e && e.cat==='cardio').length;
    if(cardio*2>ex.length) return 'cardio';        // MOSTLY cardio
  }
  const t=String(s.title||'').toLowerCase();
  if(t && TRAIN_CARDIO_PRESETS.some(p=>new RegExp('\\b'+p.toLowerCase()+'\\b').test(t))) return 'cardio';
  return 'workout';
}
function trainTypeClass(type){ return (TRAIN_TYPES[type]||TRAIN_TYPES.workout).cls; }
/* the tag itself — one markup, used by the grid, the day builder, the dashboard
   card and the history overlay, so the colour can never mean two things */
function trainTypeTag(type){
  const m=TRAIN_TYPES[type]||TRAIN_TYPES.workout;
  return `<span class="ttag ${m.cls}">${m.label}</span>`;
}

/* ============================================================
   LINKS — per SESSION: a task always, an appointment only when timed.
   Modeled directly on scheduleMeeting / removeMeetingLinks: the linked records
   are UPDATED IN PLACE by their stored ids and never duplicated; if one was
   deleted elsewhere it is recreated cleanly. Two sessions on one day keep two
   independent sets of links.

   A timed workout deliberately gets an appointment but NOT a Time Blocker
   block. The appointment already puts it on the calendar and drives reminders;
   a block as well would show the same session twice in the ☀ Today strip.
   ============================================================ */
function syncWorkoutTask(s){
  if(!s) return;
  const ref = s.taskId ? findTaskGlobal(s.taskId) : null;
  if(ref){
    const t=ref.t;
    if(ref.dayKey!==s.date){        // moved to another day → relocate the SAME object (id preserved)
      S.days[ref.dayKey].tasks=(S.days[ref.dayKey].tasks||[]).filter(x=>x.id!==t.id);
      dayFor(s.date).tasks.push(t);
    }
    t.txt=workoutTaskText(s); t.kind='quick'; t.workoutId=s.id; t.done=!!s.done;
  }else{
    const t={id:b(), txt:workoutTaskText(s), kind:'quick', done:!!s.done, priority:false,
             mins:2, start:null, schedDate:null, workoutId:s.id};
    dayFor(s.date).tasks.push(t);
    s.taskId=t.id;
  }
}
/* drop the linked task from whichever day holds it, plus any pipeline reference */
function removeWorkoutTask(s){
  if(!s || !s.taskId) return;
  const id=s.taskId;
  Object.keys(S.days||{}).forEach(dk=>{
    const d=S.days[dk];
    if(d.tasks) d.tasks=d.tasks.filter(t=>t.id!==id);
    if(d.pipeline) d.pipeline=d.pipeline.filter(it=>it.taskId!==id);
  });
  s.taskId=null;
}
function syncWorkoutAppt(s){
  if(!s || !s.time){ removeWorkoutAppt(s); return; }
  let a = s.apptId ? (S.appointments||[]).find(x=>x.id===s.apptId) : null;
  if(a){ a.title=workoutTaskText(s); a.date=s.date; a.time=s.time; }
  else { a=createAppointment(workoutTaskText(s), s.date, s.time); s.apptId=a.id; }
  a.done=!!s.done;                 // a completed session's appointment is archived with it
}
function removeWorkoutAppt(s){
  if(!s || !s.apptId) return;
  S.appointments=(S.appointments||[]).filter(a=>a.id!==s.apptId);
  s.apptId=null;
}
/* the single writer for one session's links — called after every edit */
function syncWorkoutLinks(s){ syncWorkoutTask(s); syncWorkoutAppt(s); }

/* delete ONE session from a day, cleaning up only its own links */
function deleteSession(dk, sid){
  const day=trainDay(dk); if(!day) return;
  const s=(day.sessions||[]).find(x=>x.id===sid); if(!s) return;
  removeWorkoutTask(s); removeWorkoutAppt(s);
  day.sessions=(day.sessions||[]).filter(x=>x.id!==sid);
  save();
}
/* Rest applies to the WHOLE day and means no sessions: turning it on removes
   every session on that day along with its task and appointment. */
function setDayRest(dk, rest){
  const day=trainEnsureDay(dk);
  if(rest){
    (day.sessions||[]).slice().forEach(s=>{ removeWorkoutTask(s); removeWorkoutAppt(s); });
    day.sessions=[];
    day.rest=true;
  }else{
    day.rest=false;
  }
  save();
}

/* ============================================================
   COMPLETION — routes through the NORMAL task path.
   syncWorkoutFromTask is the one hook the task machinery calls (atToggle,
   togglePipeline, fireCompleteTask); setWorkoutDone is the one writer.
   ============================================================ */
/* find a session across every day by one of its ids */
function workoutFind(pred){
  const days=trainDays();
  const keys=Object.keys(days);
  for(let i=0;i<keys.length;i++){
    const list=(days[keys[i]]&&days[keys[i]].sessions)||[];
    const hit=list.find(pred);
    if(hit) return hit;
  }
  return null;
}
function workoutById(id){ return workoutFind(s=>s.id===id); }
function workoutByTaskId(taskId){ return workoutFind(s=>s.taskId===taskId); }
function workoutByApptId(apptId){ return workoutFind(s=>s.apptId===apptId); }
/* Called wherever a standalone day-task's done flag flips. opts.log===false
   suppresses the optional log prompt — used by the Fire Station, whose takeover
   sits above the modal layer, so a modal opened there would be invisible. */
function syncWorkoutFromTask(t, opts){
  if(!t || !t.workoutId) return;
  const s=workoutByTaskId(t.id) || workoutById(t.workoutId);
  if(!s) return;
  setWorkoutDone(s, !!t.done, opts);
}
function setWorkoutDone(s, done, opts){
  opts=opts||{};
  if(!s) return;
  s.done=!!done;
  s.doneAt = done ? todayKey() : null;
  if(s.taskId){ const ref=findTaskGlobal(s.taskId); if(ref) ref.t.done=!!done; }
  // the linked appointment archives with the session (reversible in both directions)
  if(s.apptId){ const a=(S.appointments||[]).find(x=>x.id===s.apptId); if(a) a.done=!!done; }
  save(false);
  if(done && opts.log!==false && !trainOverlayOpen()) openWorkoutLog(s.date, s.id);
}
/* Is a full-screen surface currently up? .pick-screen and .fire-screen share the
   modal's z-index band but sit LATER in the DOM, so they paint over it — a log
   prompt opened from the "see all tasks" overlay would be invisible behind it.
   In that case completing just completes; the log stays one tap away on the
   dashboard card ("Add a log"), which is the whole point of it being optional. */
function trainOverlayOpen(){
  return (typeof taskScreenOpen!=='undefined'  && taskScreenOpen)
      || (typeof leakScreenOpen!=='undefined'  && leakScreenOpen)
      || (typeof apptScreenOpen!=='undefined'  && apptScreenOpen)
      || (typeof firePickerOpen!=='undefined'  && firePickerOpen)
      || (typeof fireScreenOpen!=='undefined'  && fireScreenOpen)
      || (typeof trainScreenOpen!=='undefined' && trainScreenOpen);
}
/* The other direction: a timed session also shows in the ☀ Today strip and the
   calendar as its appointment, and those surfaces have their own ✓. Ticking there
   would otherwise archive the appointment while the session — and its task — stayed
   open. No recursion: setWorkoutDone writes a.done directly, it never calls back
   into toggleApptDone. */
function syncWorkoutFromAppt(a){
  if(!a) return;
  const s=workoutByApptId(a.id);
  if(s) setWorkoutDone(s, !!a.done);
}
/* Complete/reopen from a training surface — goes through atToggle so it is the
   exact same path as ticking the task in All Tasks or the Today strip. */
function toggleWorkoutViaTask(dk, sid){
  const s=trainSessionAt(dk, sid); if(!s) return;
  if(s.taskId && findTaskGlobal(s.taskId)) atToggle('S|'+s.taskId);
  else { setWorkoutDone(s, !s.done); rerender(); }   // defensive: link lost somehow
}

/* ============================================================
   THE OPTIONAL LOG — duration + a short note. Both optional, never required:
   Skip and Save both leave the session complete.
   ============================================================ */
let woLogDraft=null;   // {date, sid, mins, note, customOpen}
const WO_MINS=[15,30,45,60,90];

function openWorkoutLog(dk, sid){
  const s=trainSessionAt(dk, sid); if(!s) return;
  woLogDraft={ date:dk, sid:sid, mins:(s.mins!=null?s.mins:null), note:s.note||'', customOpen:false };
  renderWorkoutLog();
}
function renderWorkoutLog(){
  const d=woLogDraft; if(!d) return;
  const s=trainSessionAt(d.date, d.sid); if(!s){ closeReset(); return; }
  const custom = d.mins!=null && !WO_MINS.includes(d.mins);
  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="wlClose">×</span>
      <h3>✓ ${esc(workoutTaskText(s))}</h3>
      <p class="intro">Logged as done. Add a duration or a note if you want them — both are optional.</p>
      <div class="qf"><label>Duration</label>
        <div class="dur-pick">
          ${WO_MINS.map(v=>`<button class="dur-btn ${d.mins===v&&!d.customOpen?'sel':''}" data-wlmin="${v}">${fmtDuration(v)}</button>`).join('')}
          <button class="dur-btn ${(custom||d.customOpen)?'sel':''}" id="wlCustom">${custom?fmtDuration(d.mins):'custom'}</button>
          ${d.customOpen?`<span class="dur-custom-wrap"><input type="number" min="1" max="600" id="wlCustomIn" value="${custom?d.mins:''}" placeholder="min" class="num-in"><span class="dur-lab">min</span></span>`:''}
          ${d.mins!=null?`<button class="dur-btn" id="wlClearMin" title="Clear the duration">×</button>`:''}
        </div>
      </div>
      <div class="qf"><label>Note</label>
        <textarea id="wlNote" rows="2" placeholder="Anything worth remembering about it…">${esc(d.note||'')}</textarea>
      </div>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="wlSave">Save</button>
        <button class="btn ghost" id="wlSkip">Skip</button>
      </div>
    </div>`;
  m.classList.add('show');
  q('#wlClose').onclick=()=>{ woLogDraft=null; closeReset(); };
  q('#wlSkip').onclick=()=>{ woLogDraft=null; closeReset(); };
  q('#resetModal [data-wlmin]','all').forEach(el=>el.onclick=()=>{ d.mins=+el.dataset.wlmin; d.customOpen=false; renderWorkoutLog(); });
  const cu=q('#wlCustom'); if(cu) cu.onclick=()=>{ d.customOpen=true; renderWorkoutLog(); setTimeout(()=>{ const i=q('#wlCustomIn'); if(i) i.focus(); },0); };
  const ci=q('#wlCustomIn'); if(ci) ci.oninput=()=>{ const n=parseInt(ci.value,10); d.mins=(!isNaN(n)&&n>0)?n:null; };
  const cl=q('#wlClearMin'); if(cl) cl.onclick=()=>{ d.mins=null; d.customOpen=false; renderWorkoutLog(); };
  const nt=q('#wlNote'); if(nt) nt.oninput=()=>{ d.note=nt.value; };   // no repaint — keep the caret
  q('#wlSave').onclick=()=>{
    const cur=trainSessionAt(d.date, d.sid);
    if(cur){ cur.mins=(d.mins!=null?d.mins:null); cur.note=(d.note||'').trim(); save(); }
    woLogDraft=null; closeReset(); rerender(); toast('Logged ✓');
  };
}

/* ============================================================
   WEEKLY EVIDENCE — a FLOOR met, never a target missed.
   SESSIONS are counted, not days: a lift and a run on the same day are two
   toward the floor. Counted by each session's own date (the day it was planned
   for), so the count and the weekly grid always agree. No streaks, no
   broken-streak state, no language about what is missing.
   ============================================================ */
function trainWeekStats(mondayKey){
  const dates=trainWeekDates(mondayKey);
  const all=trainSessionsIn(dates);
  const done=all.filter(s=>s.done);
  return { floor:trainFloor(), planned:all.length, done:done.length, dates };
}
/* the phrasing itself is shared with content — see floorEvidenceLine in ui-core.js */
function trainEvidenceLine(st){ return floorEvidenceLine(st.done, st.floor); }
function trainEvidenceClass(st){ return floorEvidenceClass(st.done, st.floor); }

/* ============================================================
   THE TRAINING TAB — the weekly grid.
   ============================================================ */
let trainWeek=null;                 // displayed Monday key; null = the current week
function trainCurrentWeek(){ return trainWeek || trainWeekStart(todayKey()); }

function renderTraining(){
  const wk=trainCurrentWeek();
  const st=trainWeekStats(wk);
  const isThis = wk===trainWeekStart(todayKey());
  const tk=todayKey();

  const dayCard=(dk,i)=>{
    const list=trainDaySessions(dk);
    const rest=trainIsRest(dk);
    const isToday=dk===tk;
    const doneCt=list.filter(s=>s.done).length;
    const allDone=list.length>0 && doneCt===list.length;
    const dd=trainDateFrom(dk).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
    let body;
    if(rest){
      body=`<span class="td-rest">${trainTypeTag('rest')}</span>`;
    }else if(!list.length){
      body=`<span class="td-empty">+ plan a session</span>`;
    }else{
      // each session stacked compactly: type tag, title, exercise count, time, done
      body=`<span class="td-ses">${list.map(s=>{
        const type=trainSessionType(s);
        const bits=[workoutExLabel(s), s.time?fmtClock(s.time):''].filter(Boolean).join(' · ');
        return `<span class="td-s ${trainTypeClass(type)} ${s.done?'done':''}">
          <span class="td-s-top"><span class="td-s-tick">${s.done?'✓':'○'}</span><span class="td-s-title">${esc(workoutTaskText(s))}</span></span>
          <span class="td-s-meta">${trainTypeTag(type)}${bits?`<span class="td-s-bits">${esc(bits)}</span>`:''}</span>
        </span>`;
      }).join('')}</span>`;
    }
    return `
    <button class="train-day ${isToday?'is-today':''} ${allDone?'is-done':''} ${rest?'is-rest':''} ${(!rest&&!list.length)?'is-empty':''}" data-trainday="${dk}">
      <span class="td-head">
        <span class="td-dow">${TRAIN_DOW[i]}</span>
        <span class="td-date">${dd}</span>
        ${list.length?`<span class="td-done">${allDone?'✓':(doneCt?`${doneCt}/${list.length}`:'')}</span>`:''}
      </span>
      ${body}
    </button>`;
  };

  return `
  <div class="phead compact">
    <div class="kicker">Plan it · show up · log it</div>
    <h2>Training</h2>
  </div>

  <div class="card train-ev-card">
    <div class="card-h">
      <h3>This week</h3>
      <span class="ch-actions">
        <button class="btn ghost sm" id="trainHistory">History</button>
      </span>
    </div>
    <div class="train-ev ${trainEvidenceClass(trainWeekStats(trainWeekStart(todayKey())))}">${esc(trainEvidenceLine(trainWeekStats(trainWeekStart(todayKey()))))}</div>
    <p class="list-note" style="margin-top:8px">Your floor is ${trainFloor()} session${trainFloor()===1?'':'s'} a week — set it in Settings. Sessions count, not days: two in one day count as two. Anything past the floor is a bonus.</p>
  </div>

  <div class="card">
    <div class="card-h">
      <h3>${isThis?'This week':'Week of '+esc(trainWeekLabel(wk))}</h3>
      <span class="ch-actions">
        <span class="sub">${st.done} done · ${st.planned} planned</span>
        <button class="btn ghost sm" id="trainPrev" title="Previous week">‹</button>
        <button class="btn ghost sm" id="trainNext" title="Next week">›</button>
        ${isThis?'':'<button class="btn ghost sm" id="trainThis">This week</button>'}
      </span>
    </div>
    ${isThis?`<div class="train-week-lbl">${esc(trainWeekLabel(wk))}</div>`:''}
    <div class="train-grid">${trainWeekDates(wk).map(dayCard).join('')}</div>
    <p class="list-note" style="margin-top:12px">Tap a day to build it — a day can hold more than one session. Planned sessions become tasks; complete them anywhere you meet them. Give one a time and it lands in your calendar with reminders.</p>
  </div>
  `;
}

function bindTraining(){
  q('[data-trainday]','all').forEach(el=>el.onclick=()=>openWorkoutBuilder(el.dataset.trainday));
  const pv=q('#trainPrev'); if(pv) pv.onclick=()=>{ trainWeek=trainWeekShift(trainCurrentWeek(),-1); rerender(); };
  const nx=q('#trainNext'); if(nx) nx.onclick=()=>{ trainWeek=trainWeekShift(trainCurrentWeek(),1); rerender(); };
  const th=q('#trainThis'); if(th) th.onclick=()=>{ trainWeek=null; rerender(); };
  const hi=q('#trainHistory'); if(hi) hi.onclick=openTrainScreen;
}

/* ============================================================
   THE DAY BUILDER — the sessions on one day.
   Two levels, both in #resetModal: this lists the day's sessions and owns the
   whole-day Rest state; the SESSION EDITOR below builds one session as a draft
   that is only written on Save. Add / delete / Rest here are discrete acts and
   apply immediately (each is confirmed where it destroys something).
   ============================================================ */
let wbDay=null;    // the day key open in the day builder (null = closed)

function openWorkoutBuilder(dk){ wbDay=dk; wbDraft=null; renderDayBuilder(); }
function closeDayBuilder(){ wbDay=null; wbDraft=null; closeReset(); rerender(); }

function renderDayBuilder(){
  const dk=wbDay; if(!dk) return;
  const list=trainDaySessions(dk);
  const rest=trainIsRest(dk);
  const heading=trainDateFrom(dk).toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
  const row=(s)=>{
    const bits=[workoutExLabel(s), s.time?fmtClock(s.time):''].filter(Boolean).join(' · ');
    return `
    <div class="wd-row ${s.done?'done':''}">
      <span class="wd-tick">${s.done?'✓':'○'}</span>
      <span class="wd-main">
        <span class="wd-title">${esc(workoutTaskText(s))}${trainTypeTag(trainSessionType(s))}</span>
        ${bits?`<span class="wd-meta">${esc(bits)}</span>`:''}
        ${(s.exercises||[]).length?`<span class="wd-ex">${s.exercises.map(e=>esc(exDisplay(e))).join(' · ')}</span>`:''}
      </span>
      <button class="btn ghost sm" data-wdedit="${esc(s.id)}">Edit</button>
      <span class="x" data-wddel="${esc(s.id)}" title="Delete this session">×</span>
    </div>`;
  };
  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal modal-lg">
      <span class="modal-close" id="wdClose">×</span>
      <h3>${esc(heading)}</h3>
      <div class="wb-kind">
        <button class="wb-kind-opt ${!rest?'on':''}" data-wdday="sessions">Sessions</button>
        <button class="wb-kind-opt ${rest?'on':''}" data-wdday="rest">Rest</button>
      </div>

      ${rest ? `<p class="intro" style="margin-top:14px">A rest day. Nothing to do, nothing owed.</p>` : `
        <div class="wd-list">
          ${list.length?list.map(row).join(''):'<div class="empty sm">No sessions yet on this day.</div>'}
        </div>
        <button class="btn ghost sm wd-add" id="wdAdd">+ Add session</button>
        ${list.length>1?`<p class="list-note" style="margin-top:10px">${list.length} sessions — each has its own task${list.some(s=>s.time)?', time and reminder':''}, and each counts on its own toward your weekly floor.</p>`:''}
      `}

      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="wdDone">Done</button>
      </div>
    </div>`;
  m.classList.add('show');
  bindDayBuilder();
}
function bindDayBuilder(){
  const dk=wbDay; if(!dk) return;
  q('#wdClose').onclick=closeDayBuilder;
  q('#wdDone').onclick=closeDayBuilder;
  const add=q('#wdAdd'); if(add) add.onclick=()=>openSessionEditor(dk, null);
  q('#resetModal [data-wdedit]','all').forEach(el=>el.onclick=()=>openSessionEditor(dk, el.dataset.wdedit));
  q('#resetModal [data-wddel]','all').forEach(el=>el.onclick=()=>{
    const s=trainSessionAt(dk, el.dataset.wddel); if(!s) return;
    if(!confirm(`Delete "${workoutTaskText(s)}"? Its task${s.apptId?' and calendar appointment':''} go with it.`)) return;
    deleteSession(dk, s.id);
    renderDayBuilder(); rerender(); toast('Removed');
  });
  q('#resetModal [data-wdday]','all').forEach(el=>el.onclick=()=>{
    const want=el.dataset.wdday;
    if((want==='rest')===trainIsRest(dk)) return;   // already there — no write, no repaint
    if(want==='rest'){
      const n=trainDaySessions(dk).length;
      if(n && !confirm(`Make this a rest day? Its ${n} session${n===1?'':'s'} — and their tasks and appointments — are removed.`)) return;
      setDayRest(dk, true);
    }else{
      setDayRest(dk, false);
    }
    renderDayBuilder(); rerender();
  });
}

/* ============================================================
   THE SESSION EDITOR — one session, held as a draft and committed on Save, so
   backing out writes nothing. Cancel and Save both return to the day builder,
   so adding a second session to a day is one more tap.
   ============================================================ */
let wbDraft=null;   // {date, sid, title, exercises:[{id,name,cat,target}], time}

function openSessionEditor(dk, sid){
  const s = sid ? trainSessionAt(dk, sid) : null;
  wbDraft = s
    ? { date:dk, sid:s.id, title:s.title||'',
        exercises:(s.exercises||[]).map(e=>({id:e.id, name:e.name, cat:e.cat, target:(e.target!=null?e.target:null)})),
        time:s.time||'' }
    : { date:dk, sid:null, title:'', exercises:[], time:'' };
  renderWorkoutBuilder();
}
function wbHasEx(name,cat){ return (wbDraft.exercises||[]).some(e=>e.name===name && e.cat===cat); }
function wbToggleEx(name,cat){
  if(wbHasEx(name,cat)) wbDraft.exercises=wbDraft.exercises.filter(e=>!(e.name===name && e.cat===cat));
  else wbDraft.exercises.push({id:b(), name, cat, target:null});
}
/* pull every on-screen field into the draft before a repaint or a save — the text
   and number inputs autosave without re-rendering (so the caret never jumps), and
   this catches a value typed immediately before pressing a button */
function wbSyncFields(){
  const d=wbDraft; if(!d) return;
  const ti=q('#wbTitle'); if(ti) d.title=ti.value;
  q('#resetModal [data-wbtarget]','all').forEach(el=>{
    const e=d.exercises.find(x=>x.id===el.dataset.wbtarget);
    if(e) e.target=parseTarget(el.value);
  });
}
function renderWorkoutBuilder(){
  const d=wbDraft; if(!d) return;
  const existing = d.sid ? trainSessionAt(d.date, d.sid) : null;
  const dt=trainDateFrom(d.date);
  const heading=dt.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
  const lib=trainLib();
  const libGroups=TRAIN_CATS.map(([k,lbl])=>{
    const items=(lib[k]||[]);
    if(!items.length) return '';
    return `<div class="wb-cat">
      <div class="wb-cat-lbl">${esc(lbl)}</div>
      <div class="wb-chips">${items.map(e=>`<button class="train-chip ${wbHasEx(e.name,k)?'on':''}" data-wbex="${esc(k)}|${esc(e.name)}">${esc(e.name)}</button>`).join('')}</div>
    </div>`;
  }).join('');
  const anyLib=TRAIN_CATS.some(([k])=>(lib[k]||[]).length);

  const m=q('#resetModal');
  m.innerHTML=`
    <div class="modal modal-lg">
      <span class="modal-close" id="wbClose">×</span>
      <button class="pick-back" id="wbBack">← ${esc(heading)}</button>
      <h3>${existing?'Edit session':'New session'}</h3>

      <div class="qf" style="margin-top:14px"><label>Session</label>
        <input type="text" id="wbTitle" value="${esc(d.title)}" placeholder="Name it — Strength, Run, Circuit…">
        <div class="wb-presets">${TRAIN_PRESETS.map(p=>`<button class="train-chip ${d.title===p?'on':''}" data-wbpreset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </div>

      <div class="qf"><label>Exercises${d.exercises.length?` <span class="wb-ct">${d.exercises.length}</span>`:''}
        <span class="wb-opt">the number is optional — a total to aim at, nothing is counted against it</span></label>
        ${d.exercises.length?`<div class="wb-chosen-list">${d.exercises.map(e=>`
          <div class="wb-cx">
            <span class="wb-cx-name">${esc(e.name)}</span>
            <input type="number" class="wb-cx-target" data-wbtarget="${esc(e.id)}" value="${e.target!=null?e.target:''}" placeholder="—" min="1" max="100000" inputmode="numeric">
            <span class="x" data-wbdrop="${esc(e.id)}" title="Remove">×</span>
          </div>`).join('')}</div>`
          :`<div class="empty sm">No exercises — that's fine. A session type on its own (a Run) is a plan.</div>`}
      </div>

      <div class="wb-lib">
        ${anyLib?libGroups:'<div class="empty sm">Your library is empty — add exercises in Settings → Training library.</div>'}
      </div>

      <div class="qf" style="margin-top:16px"><label>Time <span class="wb-opt">optional — adds it to your calendar with reminders</span></label>
        <div class="wb-time">
          <input type="time" id="wbTime" value="${esc(d.time||'')}">
          ${d.time?`<button class="btn ghost sm" id="wbTimeClear">Clear</button>`:''}
        </div>
      </div>

      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="wbSave">Save</button>
        ${existing?`<button class="btn ghost sm danger" id="wbDel">Delete</button>`:''}
        <button class="btn ghost" id="wbCancel">Cancel</button>
      </div>
    </div>`;
  m.classList.add('show');
  bindWorkoutBuilder();
}
function bindWorkoutBuilder(){
  const d=wbDraft; if(!d) return;
  const back=()=>{ wbDraft=null; if(wbDay) renderDayBuilder(); else { closeReset(); rerender(); } };
  q('#wbClose').onclick=()=>{ wbDraft=null; closeDayBuilder(); };
  q('#wbCancel').onclick=back;
  const bk=q('#wbBack'); if(bk) bk.onclick=back;
  const ti=q('#wbTitle'); if(ti) ti.oninput=()=>{ d.title=ti.value; };   // no repaint — keep the caret
  // the optional target: written into the draft as you type, never re-rendering
  q('#resetModal [data-wbtarget]','all').forEach(el=>el.oninput=()=>{
    const e=d.exercises.find(x=>x.id===el.dataset.wbtarget);
    if(e) e.target=parseTarget(el.value);
  });
  q('#resetModal [data-wbpreset]','all').forEach(el=>el.onclick=()=>{
    wbSyncFields();
    const p=el.dataset.wbpreset;
    d.title = (d.title===p) ? '' : p;
    renderWorkoutBuilder();
  });
  q('#resetModal [data-wbex]','all').forEach(el=>el.onclick=()=>{
    wbSyncFields();
    const v=el.dataset.wbex, i=v.indexOf('|');
    wbToggleEx(v.slice(i+1), v.slice(0,i));
    renderWorkoutBuilder();
  });
  q('#resetModal [data-wbdrop]','all').forEach(el=>el.onclick=()=>{
    wbSyncFields();
    d.exercises=d.exercises.filter(e=>e.id!==el.dataset.wbdrop);
    renderWorkoutBuilder();
  });
  const tm=q('#wbTime'); if(tm) tm.onchange=()=>{ wbSyncFields(); d.time=tm.value||''; renderWorkoutBuilder(); };
  const tc=q('#wbTimeClear'); if(tc) tc.onclick=()=>{ wbSyncFields(); d.time=''; renderWorkoutBuilder(); };
  const dl=q('#wbDel'); if(dl) dl.onclick=()=>{
    const s=trainSessionAt(d.date, d.sid); if(!s) return;
    if(!confirm(`Delete "${workoutTaskText(s)}"? Its task${s.apptId?' and calendar appointment':''} go with it.`)) return;
    deleteSession(d.date, d.sid);
    wbDraft=null; renderDayBuilder(); rerender(); toast('Removed');
  };
  q('#wbSave').onclick=saveWorkoutBuilder;
}
function saveWorkoutBuilder(){
  const d=wbDraft; if(!d) return;
  wbSyncFields();                     // title + every target, read live
  const day=trainEnsureDay(d.date);
  day.rest=false;                     // a day with a session on it is not a rest day
  let s = d.sid ? trainSessionAt(d.date, d.sid) : null;
  if(!s){
    s={ id:b(), date:d.date, title:'', exercises:[], time:null, taskId:null,
        apptId:null, done:false, doneAt:null, mins:null, note:'', createdAt:Date.now() };
    day.sessions.push(s);
  }
  s.title=(d.title||'').trim();
  s.exercises=d.exercises.map(e=>({id:e.id, name:e.name, cat:e.cat, target:(e.target!=null?e.target:null)}));
  s.time=(d.time||'')||null;
  syncWorkoutLinks(s);                // task always; appointment only while a time is set
  save();
  wbDraft=null;
  renderDayBuilder();                 // back to the day, so a second session is one tap
  rerender();
  toast(s.time?'Planned ✓ · in your calendar':'Planned ✓');
}

/* ============================================================
   DASHBOARD — today's sessions, each with its own complete action.
   ============================================================ */
function renderTodayWorkout(){
  const dk=todayKey();
  const list=trainDaySessions(dk);
  const st=trainWeekStats(trainWeekStart(dk));
  const ev=`<div class="wo-ev ${trainEvidenceClass(st)}">${esc(trainEvidenceLine(st))}</div>`;

  if(trainIsRest(dk)){
    return `
    <div class="card wo-card is-rest">
      <div class="card-h"><h3>⌁ Today's workout</h3><span class="ch-actions">${ev}</span></div>
      <div class="wo-rest">${trainTypeTag('rest')} Rest day. Nothing to do, nothing owed.</div>
    </div>`;
  }
  if(!list.length){
    return `
    <div class="card wo-card">
      <div class="card-h"><h3>⌁ Today's workout</h3><span class="ch-actions">${ev}</span></div>
      <div class="wo-none">Nothing planned for today — <button class="wo-link" id="woGoPlan">plan your week in Training</button>.</div>
    </div>`;
  }
  const doneCt=list.filter(s=>s.done).length;
  const item=(s)=>{
    const bits=[s.time?fmtClock(s.time):'', workoutExLabel(s)].filter(Boolean).join(' · ');
    const logged=[s.mins!=null?fmtDuration(s.mins):'', (s.note||'').trim()].filter(Boolean).join(' · ');
    return `
    <div class="wo-item ${s.done?'is-done':''}">
      <div class="wo-l">
        <div class="wo-title">${esc(workoutTaskText(s))}${trainTypeTag(trainSessionType(s))}${bits?`<span class="wo-meta">${esc(bits)}</span>`:''}</div>
        ${(s.exercises||[]).length?`<div class="wo-ex">${s.exercises.map(e=>`<span class="wo-ex-chip">${esc(exDisplay(e))}</span>`).join('')}</div>`:''}
        ${s.done&&logged?`<div class="wo-logged">✓ ${esc(logged)}</div>`:''}
      </div>
      <div class="wo-r">
        ${s.done
          ? `<button class="btn ghost sm" data-wolog="${esc(s.id)}">${(s.mins!=null||(s.note||'').trim())?'Edit log':'Add a log'}</button>
             <button class="btn ghost sm" data-wotoggle="${esc(s.id)}" title="Mark not done">↩ Undo</button>`
          : `<button class="btn" data-wotoggle="${esc(s.id)}">✓ Complete</button>`}
      </div>
    </div>`;
  };
  return `
  <div class="card wo-card ${doneCt===list.length?'is-done':''}">
    <div class="card-h"><h3>⌁ Today's workout</h3>
      <span class="ch-actions">${list.length>1?`<span class="sub">${doneCt}/${list.length} done</span>`:''}${ev}</span></div>
    <div class="wo-list">${list.map(item).join('')}</div>
  </div>`;
}
function bindTodayWorkout(){
  const g=q('#woGoPlan'); if(g) g.onclick=()=>go('training');
  q('[data-wotoggle]','all').forEach(el=>el.onclick=()=>toggleWorkoutViaTask(todayKey(), el.dataset.wotoggle));
  q('[data-wolog]','all').forEach(el=>el.onclick=()=>openWorkoutLog(todayKey(), el.dataset.wolog));
}

/* ============================================================
   HISTORY — previous weeks and what got done in them.
   Reuses the .pick-screen component (shell, header, density step-down,
   body.pick-open) in its own host OUTSIDE .app, exactly like the leaks and
   appointments overlays, so a rerender() behind it can never disturb it.
   ============================================================ */
let trainScreenOpen=false;
function openTrainScreen(){ trainScreenOpen=true; paintTrainScreen(); }
function closeTrainScreen(){ trainScreenOpen=false; paintTrainScreen(); rerender(); }

/* every week that holds at least one COMPLETED session, most recent first */
function trainHistoryWeeks(){
  const days=trainDays();
  const by={};
  Object.keys(days).forEach(dk=>{
    ((days[dk]&&days[dk].sessions)||[]).forEach(s=>{
      if(!s || !s.done) return;
      const wk=trainWeekStart(dk);
      (by[wk]=by[wk]||[]).push(s);
    });
  });
  return Object.keys(by).sort((a,b)=>b.localeCompare(a)).map(wk=>({
    key:wk,
    sessions:by[wk].sort((a,b)=>String(a.date).localeCompare(String(b.date))),
  }));
}
function trainScreenHTML(){
  const weeks=trainHistoryWeeks();
  const thisWk=trainWeekStart(todayKey());
  const floor=trainFloor();
  const total=weeks.reduce((n,w)=>n+w.sessions.length,0);
  const row=(s)=>{
    const bits=[s.mins!=null?fmtDuration(s.mins):'', (s.note||'').trim()].filter(Boolean).join(' · ');
    return `<div class="pick-row is-hist">
      <span class="trh-day">${TRAIN_DOW[(trainDateFrom(s.date).getDay()+6)%7]}</span>
      ${trainTypeTag(trainSessionType(s))}
      <span class="pick-txt">${esc(workoutTaskText(s))}</span>
      ${bits?`<span class="trh-log">${esc(bits)}</span>`:''}
    </div>`;
  };
  const group=(w)=>{
    const n=w.sessions.length;
    const met=n>=floor;
    return `<section class="pick-group" style="--gc:${met?'var(--green)':'var(--txt-dim)'}">
      <h3 class="pick-g-title">${w.key===thisWk?'This week':esc(trainWeekLabel(w.key))}<span class="pick-g-ct">${n}</span></h3>
      <div class="trh-ev ${met?'met':''}">${met?`${floor} of ${floor} floor met${n-floor>0?` · ${n-floor} bonus`:''}`:`${n} session${n===1?'':'s'}`}</div>
      <div class="pick-rows">${w.sessions.map(row).join('')}</div>
    </section>`;
  };
  return `<div class="pick-inner">
    <header class="pick-head">
      <div class="pick-h-txt"><h2>⌁ Training history</h2>
        <p>Every session you completed, week by week. Evidence, not a scoreboard.</p></div>
      <span class="pick-h-ct">${total} session${total===1?'':'s'}</span>
      <button class="pick-close" id="trainScreenClose" title="Close">×</button>
    </header>
    ${weeks.length
      ? `<div class="pick-body">${weeks.map(group).join('')}</div>`
      : `<div class="empty">No completed sessions yet. Plan one in Training and it lands here when it's done.</div>`}
  </div>`;
}
function paintTrainScreen(){
  const el=q('#trainScreen'); if(!el) return;
  if(!trainScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=trainScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  const cl=q('#trainScreenClose'); if(cl) cl.onclick=closeTrainScreen;
  fitPickScreen(el);
}

/* ============================================================
   SETTINGS — the exercise library (names only).
   Rendered from renderSettings()/bindSettings(), the same way Projects and
   Recurring are, so Settings stays the one place things are maintained.
   ============================================================ */
let trainLibDraft={};   // {category: in-progress new exercise name}

function renderTrainingLibrary(){
  const lib=trainLib();
  const cat=([k,lbl])=>{
    const items=lib[k]||[];
    return `
    <div class="train-lib-cat">
      <div class="tl-head"><span class="tl-lbl">${esc(lbl)}</span><span class="tl-ct">${items.length}</span></div>
      <div class="tl-list">
        ${items.length?items.map(e=>`
          <div class="tl-row">
            <input type="text" class="tl-name" data-tlname="${esc(k)}|${esc(e.id)}" value="${esc(e.name)}">
            <span class="x" data-tldel="${esc(k)}|${esc(e.id)}" title="Delete">×</span>
          </div>`).join(''):'<div class="empty sm">Empty — add what you actually do.</div>'}
      </div>
      <div class="tl-add">
        <input type="text" data-tladd="${esc(k)}" value="${esc(trainLibDraft[k]||'')}" placeholder="Add to ${esc(lbl)}…">
        <button class="btn sm" data-tladdbtn="${esc(k)}">+</button>
      </div>
    </div>`;
  };
  return `
  <div class="card" id="trainingLibrary">
    <div class="card-h"><h3>⌁ Training library</h3><span class="sub">names only</span></div>
    <p class="list-note" style="margin-top:0">Your exercises, by category — names only. Any target number you type belongs to that one session, so it never follows the exercise around. Renaming or deleting one here never changes a session you already did. Your weekly floor is set in <b>Weekly floors</b> above.</p>
    <div class="train-lib" style="margin-top:14px">${TRAIN_CATS.map(cat).join('')}</div>
  </div>`;
}
function bindTrainingLibrary(){
  const pair=(v)=>{ const i=String(v).indexOf('|'); return [String(v).slice(0,i), String(v).slice(i+1)]; };
  // rename — save WITHOUT re-rendering so the caret never jumps mid-word
  q('[data-tlname]','all').forEach(el=>el.oninput=()=>{
    const [k,id]=pair(el.dataset.tlname);
    const e=(trainLib()[k]||[]).find(x=>x.id===id);
    if(e){ e.name=el.value; save(); }
  });
  q('[data-tldel]','all').forEach(el=>el.onclick=()=>{
    const [k,id]=pair(el.dataset.tldel);
    const list=trainLib()[k]||[];
    const e=list.find(x=>x.id===id); if(!e) return;
    if(!confirm(`Delete "${e.name}" from ${trainCatLabel(k)}? Sessions that already used it keep it.`)) return;
    S.training.library[k]=list.filter(x=>x.id!==id);
    save(); rerender();
  });
  q('[data-tladd]','all').forEach(el=>el.oninput=()=>{ trainLibDraft[el.dataset.tladd]=el.value; });
  q('[data-tladd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addLibExercise(el.dataset.tladd); } });
  q('[data-tladdbtn]','all').forEach(el=>el.onclick=()=>addLibExercise(el.dataset.tladdbtn));
}
function addLibExercise(k){
  const v=(trainLibDraft[k]||'').trim(); if(!v) return;
  if(!S.training.library[k]) S.training.library[k]=[];
  S.training.library[k].push({id:b(), name:v});
  trainLibDraft[k]='';
  save(); rerender();
}
