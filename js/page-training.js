/* ============================================================
   TRAINING — plan the workout, show up, log it, build evidence.

   Deliberately simple. No reps, sets, weights, distances, timers, exercise
   instructions, progressive overload or analytics. The whole module is three
   moves: maintain a library of exercise NAMES (Settings), build a week of
   sessions (this tab), and complete them through the normal task path.

   Store: S.training — see seedDefaults() in state.js for the shape.
     library  : {category: [{id,name}]}     — names only
     floor    : the weekly FLOOR (default 3), never a target
     sessions : {'YYYY-MM-DD': session}     — one session per day, keyed by date

   A session is keyed by DATE rather than by weekday, so the weekly grid is just
   "the seven dates of the displayed week" and history comes for free: editing this
   week can never rewrite a week you already did.

   A planned session is a TASK (see syncWorkoutTask) and, when it has a time, also
   a linked APPOINTMENT (see syncWorkoutAppt) — exactly the way a scheduled meeting
   works. There is no separate completion surface: you complete the task, wherever
   you meet it, and the session follows.
   ============================================================ */

/* ---------- date helpers (local, matching todayKey()) ---------- */
function trainDayKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function trainDateFrom(dk){ const [y,m,d]=String(dk).split('-').map(Number); return new Date(y,m-1,d); }
/* Monday of the week containing dk */
function trainWeekStart(dk){ const d=trainDateFrom(dk); d.setDate(d.getDate()-((d.getDay()+6)%7)); return trainDayKey(d); }
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
function trainSessions(){ return (S.training&&S.training.sessions)||{}; }
function trainSession(dk){ return trainSessions()[dk]||null; }
function trainCatLabel(k){ const f=TRAIN_CATS.find(c=>c[0]===k); return f?f[1]:k; }
/* the one line a session shows everywhere — the task text, the appointment title */
function workoutTaskText(s){ return ((s&&s.title)||'').trim() || 'Training'; }
function workoutExLabel(s){
  const n=((s&&s.exercises)||[]).length;
  return n?`${n} exercise${n===1?'':'s'}`:'';
}

/* ============================================================
   LINKS — task (always) + appointment (only when a time is set).
   Modeled directly on scheduleMeeting / removeMeetingLinks: the linked records
   are UPDATED IN PLACE by their stored ids and never duplicated; if one was
   deleted elsewhere it is recreated cleanly.

   A timed workout deliberately gets an appointment but NOT a Time Blocker
   block. The appointment already puts it on the calendar and drives reminders;
   a block as well would show the same session twice in the ☀ Today strip.
   ============================================================ */
function syncWorkoutTask(s){
  if(!s || s.kind!=='session'){ removeWorkoutTask(s); return; }   // a Rest day carries no task
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
  if(!s || s.kind!=='session' || !s.time){ removeWorkoutAppt(s); return; }
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
/* the single writer for a session's links — called after every edit */
function syncWorkoutLinks(s){ syncWorkoutTask(s); syncWorkoutAppt(s); }

function deleteWorkout(dk){
  const s=trainSession(dk); if(!s) return;
  removeWorkoutTask(s); removeWorkoutAppt(s);
  delete S.training.sessions[dk];
  save();
}

/* ============================================================
   COMPLETION — routes through the NORMAL task path.
   syncWorkoutFromTask is the one hook the task machinery calls (atToggle,
   togglePipeline, fireCompleteTask); setWorkoutDone is the one writer.
   ============================================================ */
function workoutById(id){
  const ss=trainSessions();
  const k=Object.keys(ss).find(dk=>ss[dk] && ss[dk].id===id);
  return k?ss[k]:null;
}
function workoutByTaskId(taskId){
  const ss=trainSessions();
  const k=Object.keys(ss).find(dk=>ss[dk] && ss[dk].taskId===taskId);
  return k?ss[k]:null;
}
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
  if(done && opts.log!==false && !trainOverlayOpen()) openWorkoutLog(s.date);
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
  const ss=trainSessions();
  const k=Object.keys(ss).find(dk=>ss[dk] && ss[dk].apptId===a.id);
  if(!k) return;
  setWorkoutDone(ss[k], !!a.done);
}
/* Complete/reopen from a training surface — goes through atToggle so it is the
   exact same path as ticking the task in All Tasks or the Today strip. */
function toggleWorkoutViaTask(dk){
  const s=trainSession(dk); if(!s) return;
  if(s.taskId && findTaskGlobal(s.taskId)) atToggle('S|'+s.taskId);
  else { setWorkoutDone(s, !s.done); rerender(); }   // defensive: link lost somehow
}

/* ============================================================
   THE OPTIONAL LOG — duration + a short note. Both optional, never required:
   Skip and Save both leave the session complete.
   ============================================================ */
let woLogDraft=null;   // {date, mins, note, customOpen}
const WO_MINS=[15,30,45,60,90];

function openWorkoutLog(dk){
  const s=trainSession(dk); if(!s) return;
  woLogDraft={ date:dk, mins:(s.mins!=null?s.mins:null), note:s.note||'', customOpen:false };
  renderWorkoutLog();
}
function renderWorkoutLog(){
  const d=woLogDraft; if(!d) return;
  const s=trainSession(d.date); if(!s){ closeReset(); return; }
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
    const cur=trainSession(d.date);
    if(cur){ cur.mins=(d.mins!=null?d.mins:null); cur.note=(d.note||'').trim(); save(); }
    woLogDraft=null; closeReset(); rerender(); toast('Logged ✓');
  };
}

/* ============================================================
   WEEKLY EVIDENCE — a FLOOR met, never a target missed.
   Counted by the session's own date (the day it was planned for), so the count
   and the weekly grid always agree. No streaks, no broken-streak state, no
   language about what is missing.
   ============================================================ */
function trainWeekStats(mondayKey){
  const ss=trainSessions();
  const dates=trainWeekDates(mondayKey);
  const planned=dates.filter(dk=>ss[dk] && ss[dk].kind==='session');
  const done=planned.filter(dk=>ss[dk].done);
  return { floor:trainFloor(), planned:planned.length, done:done.length, doneKeys:done, dates };
}
function trainEvidenceLine(st){
  const f=st.floor, n=st.done;
  if(n>=f){ const bonus=n-f; return `${f} of ${f} floor met${bonus?` · ${bonus} bonus`:''}`; }
  if(n===0) return `Floor is ${f} this week — the first one starts it`;
  return `${n} of ${f} toward your floor`;
}
function trainEvidenceClass(st){ return st.done>=st.floor?'met':''; }

/* ============================================================
   THE TRAINING TAB — the weekly builder.
   ============================================================ */
let trainWeek=null;                 // displayed Monday key; null = the current week
function trainCurrentWeek(){ return trainWeek || trainWeekStart(todayKey()); }

function renderTraining(){
  const wk=trainCurrentWeek();
  const st=trainWeekStats(wk);
  const isThis = wk===trainWeekStart(todayKey());
  const ss=trainSessions();
  const tk=todayKey();

  const dayCard=(dk,i)=>{
    const s=ss[dk];
    const isToday=dk===tk;
    const dd=trainDateFrom(dk).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
    let body;
    if(!s){
      body=`<span class="td-empty">+ plan a session</span>`;
    }else if(s.kind==='rest'){
      body=`<span class="td-title rest">Rest</span>`;
    }else{
      const bits=[workoutExLabel(s), s.time?fmtClock(s.time):''].filter(Boolean).join(' · ');
      body=`<span class="td-title">${esc(workoutTaskText(s))}</span>
            ${bits?`<span class="td-meta">${esc(bits)}</span>`:''}
            ${(s.exercises||[]).length?`<span class="td-ex">${s.exercises.slice(0,4).map(e=>esc(e.name)).join(' · ')}${s.exercises.length>4?' …':''}</span>`:''}`;
    }
    return `
    <button class="train-day ${isToday?'is-today':''} ${s&&s.done?'is-done':''} ${s&&s.kind==='rest'?'is-rest':''} ${!s?'is-empty':''}" data-trainday="${dk}">
      <span class="td-head">
        <span class="td-dow">${TRAIN_DOW[i]}</span>
        <span class="td-date">${dd}</span>
        ${s&&s.done?'<span class="td-done">✓</span>':''}
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
    <div class="train-ev ${trainEvidenceClass(st)}">${esc(trainEvidenceLine(trainWeekStats(trainWeekStart(todayKey()))))}</div>
    <p class="list-note" style="margin-top:8px">Your floor is ${trainFloor()} session${trainFloor()===1?'':'s'} a week — set it in Settings. Anything past it is a bonus.</p>
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
    <p class="list-note" style="margin-top:12px">Tap a day to build it. Planned sessions become tasks — complete them anywhere you meet them. Give one a time and it lands in your calendar with reminders.</p>
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
   THE BUILDER — one day's session. Held as a draft and committed on Save, so
   backing out writes nothing. Rendered into #resetModal, the same host the
   meeting scheduler and the project scheduler use.
   ============================================================ */
let wbDraft=null;   // {date, kind, title, exercises:[{id,name,cat}], time}

function openWorkoutBuilder(dk){
  const s=trainSession(dk);
  wbDraft = s
    ? { date:dk, kind:s.kind, title:s.title||'', exercises:(s.exercises||[]).map(e=>({id:e.id,name:e.name,cat:e.cat})), time:s.time||'' }
    : { date:dk, kind:'session', title:'', exercises:[], time:'' };
  renderWorkoutBuilder();
}
function wbHasEx(name,cat){ return (wbDraft.exercises||[]).some(e=>e.name===name && e.cat===cat); }
function wbToggleEx(name,cat){
  if(wbHasEx(name,cat)) wbDraft.exercises=wbDraft.exercises.filter(e=>!(e.name===name && e.cat===cat));
  else wbDraft.exercises.push({id:b(), name, cat});
}
function renderWorkoutBuilder(){
  const d=wbDraft; if(!d) return;
  const existing=trainSession(d.date);
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
      <h3>${esc(heading)}</h3>
      <div class="wb-kind">
        <button class="wb-kind-opt ${d.kind==='session'?'on':''}" data-wbkind="session">Session</button>
        <button class="wb-kind-opt ${d.kind==='rest'?'on':''}" data-wbkind="rest">Rest</button>
      </div>

      ${d.kind==='rest' ? `<p class="intro" style="margin-top:14px">A rest day. Nothing to do, nothing owed.</p>` : `
      <div class="qf" style="margin-top:16px"><label>Session</label>
        <input type="text" id="wbTitle" value="${esc(d.title)}" placeholder="Name it — Strength, Run, Circuit…">
        <div class="wb-presets">${TRAIN_PRESETS.map(p=>`<button class="train-chip ${d.title===p?'on':''}" data-wbpreset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      </div>

      <div class="qf"><label>Exercises${d.exercises.length?` <span class="wb-ct">${d.exercises.length}</span>`:''}</label>
        ${d.exercises.length?`<div class="wb-chosen">${d.exercises.map(e=>`<button class="train-chip on" data-wbdrop="${esc(e.id)}" title="Remove">${esc(e.name)} ×</button>`).join('')}</div>`
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
      </div>`}

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
  const close=()=>{ wbDraft=null; closeReset(); };
  q('#wbClose').onclick=close;
  q('#wbCancel').onclick=close;
  q('#resetModal [data-wbkind]','all').forEach(el=>el.onclick=()=>{ d.kind=el.dataset.wbkind; renderWorkoutBuilder(); });
  const ti=q('#wbTitle'); if(ti) ti.oninput=()=>{ d.title=ti.value; };   // no repaint — keep the caret
  q('#resetModal [data-wbpreset]','all').forEach(el=>el.onclick=()=>{
    const p=el.dataset.wbpreset;
    d.title = (d.title===p) ? '' : p;
    renderWorkoutBuilder();
  });
  q('#resetModal [data-wbex]','all').forEach(el=>el.onclick=()=>{
    const v=el.dataset.wbex, i=v.indexOf('|');
    wbToggleEx(v.slice(i+1), v.slice(0,i));
    renderWorkoutBuilder();
  });
  q('#resetModal [data-wbdrop]','all').forEach(el=>el.onclick=()=>{
    d.exercises=d.exercises.filter(e=>e.id!==el.dataset.wbdrop);
    renderWorkoutBuilder();
  });
  const tm=q('#wbTime'); if(tm) tm.onchange=()=>{ d.time=tm.value||''; renderWorkoutBuilder(); };
  const tc=q('#wbTimeClear'); if(tc) tc.onclick=()=>{ d.time=''; renderWorkoutBuilder(); };
  const dl=q('#wbDel'); if(dl) dl.onclick=()=>{
    const s=trainSession(d.date); if(!s) return;
    if(!confirm(`Delete the session planned for ${apptDateLabel(d.date)}? Its task${s.apptId?' and calendar appointment':''} go with it.`)) return;
    deleteWorkout(d.date);
    wbDraft=null; closeReset(); rerender(); toast('Removed');
  };
  q('#wbSave').onclick=saveWorkoutBuilder;
}
function saveWorkoutBuilder(){
  const d=wbDraft; if(!d) return;
  // read the title straight off the field: it autosaves into the draft without a
  // repaint, so a save fired before any other interaction still sees the latest text
  const ti=q('#wbTitle'); if(ti) d.title=ti.value;
  if(!S.training.sessions) S.training.sessions={};
  let s=trainSession(d.date);
  if(!s){
    s={ id:b(), date:d.date, kind:'session', title:'', exercises:[], time:null, taskId:null,
        apptId:null, done:false, doneAt:null, mins:null, note:'', createdAt:Date.now() };
    S.training.sessions[d.date]=s;
  }
  s.kind=d.kind;
  // Rest is the absence of a session, so it can't be complete or logged. Its task
  // and appointment are removed by syncWorkoutLinks below.
  if(d.kind==='rest'){ s.title=''; s.exercises=[]; s.time=null; s.done=false; s.doneAt=null; s.mins=null; s.note=''; }
  else{
    s.title=(d.title||'').trim();
    s.exercises=d.exercises.map(e=>({id:e.id, name:e.name, cat:e.cat}));
    s.time=(d.time||'')||null;
  }
  syncWorkoutLinks(s);      // task always; appointment only while a time is set
  save();
  wbDraft=null; closeReset(); rerender();
  toast(d.kind==='rest' ? 'Rest day' : (s.time?'Planned ✓ · in your calendar':'Planned ✓'));
}

/* ============================================================
   DASHBOARD — today's workout.
   ============================================================ */
function renderTodayWorkout(){
  const dk=todayKey();
  const s=trainSession(dk);
  const st=trainWeekStats(trainWeekStart(dk));
  const ev=`<div class="wo-ev ${trainEvidenceClass(st)}">${esc(trainEvidenceLine(st))}</div>`;

  if(!s){
    return `
    <div class="card wo-card">
      <div class="card-h"><h3>⌁ Today's workout</h3><span class="ch-actions">${ev}</span></div>
      <div class="wo-none">Nothing planned for today — <button class="wo-link" id="woGoPlan">plan your week in Training</button>.</div>
    </div>`;
  }
  if(s.kind==='rest'){
    return `
    <div class="card wo-card is-rest">
      <div class="card-h"><h3>⌁ Today's workout</h3><span class="ch-actions">${ev}</span></div>
      <div class="wo-rest">Rest day. Nothing to do, nothing owed.</div>
    </div>`;
  }
  const bits=[s.time?fmtClock(s.time):'', workoutExLabel(s)].filter(Boolean).join(' · ');
  const logged=[s.mins!=null?fmtDuration(s.mins):'', (s.note||'').trim()].filter(Boolean).join(' · ');
  return `
  <div class="card wo-card ${s.done?'is-done':''}">
    <div class="card-h"><h3>⌁ Today's workout</h3><span class="ch-actions">${ev}</span></div>
    <div class="wo-main">
      <div class="wo-l">
        <div class="wo-title">${esc(workoutTaskText(s))}${bits?`<span class="wo-meta">${esc(bits)}</span>`:''}</div>
        ${(s.exercises||[]).length?`<div class="wo-ex">${s.exercises.map(e=>`<span class="wo-ex-chip">${esc(e.name)}</span>`).join('')}</div>`:''}
        ${s.done&&logged?`<div class="wo-logged">✓ ${esc(logged)}</div>`:''}
      </div>
      <div class="wo-r">
        ${s.done
          ? `<button class="btn ghost sm" id="woLog">${s.mins!=null||(s.note||'').trim()?'Edit log':'Add a log'}</button>
             <button class="btn ghost sm" id="woUndo" title="Mark not done">↩ Undo</button>`
          : `<button class="btn" id="woDone">✓ Complete</button>`}
      </div>
    </div>
  </div>`;
}
function bindTodayWorkout(){
  const g=q('#woGoPlan'); if(g) g.onclick=()=>go('training');
  const dn=q('#woDone'); if(dn) dn.onclick=()=>toggleWorkoutViaTask(todayKey());
  const un=q('#woUndo'); if(un) un.onclick=()=>toggleWorkoutViaTask(todayKey());
  const lg=q('#woLog'); if(lg) lg.onclick=()=>openWorkoutLog(todayKey());
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
  const ss=trainSessions();
  const by={};
  Object.keys(ss).forEach(dk=>{
    const s=ss[dk];
    if(!s || s.kind!=='session' || !s.done) return;
    const wk=trainWeekStart(dk);
    (by[wk]=by[wk]||[]).push(s);
  });
  return Object.keys(by).sort((a,b)=>b.localeCompare(a)).map(wk=>({
    key:wk,
    sessions:by[wk].sort((a,b)=>a.date.localeCompare(b.date)),
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
   SETTINGS — the exercise library + the weekly floor.
   Rendered from renderSettings()/bindSettings(), the same way Projects and
   Recurring are, so Settings stays the one place things are maintained.
   ============================================================ */
let trainLibDraft={};   // {category: in-progress new exercise name}

function renderTrainingLibrary(){
  const lib=trainLib();
  const floor=trainFloor();
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
    <p class="list-note" style="margin-top:0">Your exercises, by category. These are what the weekly builder offers you in the <b>Training</b> tab. Renaming or deleting one here never changes a session you already did.</p>
    <div class="set-row" style="margin:14px 0 18px">
      <label>Weekly floor</label>
      <select id="trainFloorSel">${[1,2,3,4,5,6,7].map(n=>`<option value="${n}" ${n===floor?'selected':''}>${n} session${n===1?'':'s'}</option>`).join('')}</select>
      <span class="tl-floor-note">the minimum you're holding yourself to — anything past it is a bonus</span>
    </div>
    <div class="train-lib">${TRAIN_CATS.map(cat).join('')}</div>
  </div>`;
}
function bindTrainingLibrary(){
  const pair=(v)=>{ const i=String(v).indexOf('|'); return [String(v).slice(0,i), String(v).slice(i+1)]; };
  const fl=q('#trainFloorSel'); if(fl) fl.onchange=()=>{ S.training.floor=+fl.value; save(); rerender(); };
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
