/* ---------- task helpers ---------- */
const QUICK_LIMIT=2;   // a "quick" task is <= this many minutes
function quickTasks(){ return day().tasks.filter(t=>t.kind==='quick'); }
function projectTasks(){ return day().tasks.filter(t=>t.kind==='project'); }
/* today's task scheduled-state, used by the inbox display */
function scheduledProjects(){ return projectTasks().filter(t=>t.schedDate!=null).sort((a,b)=>(a.start||0)-(b.start||0)); }
function unscheduledProjects(){ return projectTasks().filter(t=>t.schedDate==null && !t.done); }

/* ---- GLOBAL pool across all days (for the Time Blocker) ----
   Each entry: {t (task ref), dayKey (which day's record it lives in)} */
function allTimeBlockTasks(){
  const out=[];
  Object.keys(S.days||{}).forEach(dk=>{
    (S.days[dk].tasks||[]).forEach(t=>{ if(t.kind==='project') out.push({t,dayKey:dk}); });
  });
  return out;
}
/* the Needs-Scheduling pool. Recurring tasks are re-injected fresh into EACH day's
   record and never carried/removed, so a leftover unscheduled instance piles up in
   every past day. Show a recurring instance ONLY for today, so each recurring task
   appears at most once; non-recurring project tasks are carried into today anyway. */
function poolUnscheduled(){
  const tk=todayKey();
  return allTimeBlockTasks().filter(e=>
    e.t.schedDate==null && !e.t.done && (!e.t.recurringId || e.dayKey===tk));
}
function scheduledOn(dateKey){ return allTimeBlockTasks().filter(e=>e.t.schedDate===dateKey && !e.t.done).sort((a,b)=>(a.t.start||0)-(b.t.start||0)); }
function findTaskGlobal(id){
  for(const dk of Object.keys(S.days||{})){
    const t=(S.days[dk].tasks||[]).find(x=>x.id===id);
    if(t) return {t,dayKey:dk};
  }
  return null;
}
/* the (non-done) time-block task linked to a given project task, if any */
function linkedTimeBlock(pid, ptId){
  return allTimeBlockTasks().find(e=>e.t.projectId===pid && e.t.projTaskId===ptId && !e.t.done) || null;
}
/* mark a project task done/undone and keep every linked time-block task in sync
   (so completing it anywhere updates project progress AND the time blocker) */
function setProjTaskDone(pid, ptId, done){
  const p=(S.projects||[]).find(x=>x.id===pid);
  const t=p&&(p.tasks||[]).find(x=>x.id===ptId);
  // stamp the completion DAY (not time) so the dashboard can split "Completed
  // Today" from the older Archive; cleared on un-complete.
  if(t){ t.done=done; t.doneAt = done?todayKey():null; }
  allTimeBlockTasks().forEach(e=>{ if(e.t.projectId===pid && e.t.projTaskId===ptId) e.t.done=done; });
}

function completedToday(){
  const live=day().tasks.filter(t=>t.done);
  return [...day().archive, ...live];
}
function fmtHour(h){
  const hr=Math.floor(h); const m=Math.round((h-hr)*60);
  const ampm=hr>=12?'pm':'am'; let disp=hr%12; if(disp===0)disp=12;
  return disp+(m?':'+String(m).padStart(2,'0'):'')+ampm;
}
function shortDate(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-CA',{month:'short',day:'numeric'}); }
function schedLabel(t){
  if(t.schedDate==null) return '';
  const datePart = (t.schedDate===todayKey())?'Today':shortDate(t.schedDate);
  return datePart + (t.start!=null?(' · '+fmtHour(t.start)):'');
}
function nowHM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

/* ---------- duration ---------- */
const DURATION_PRESETS=[15,30,45,60,90,120,180];   // minutes
function fmtDuration(m){
  if(m==null) return '';
  if(m<60) return m+'m';
  const h=m/60;
  return (Number.isInteger(h)?h:h.toFixed(1).replace('.0',''))+'h';
}

function addTask(txt,kind,mins){
  txt=txt.trim(); if(!txt) return;
  const t={id:b(),txt,kind,done:false,priority:false,mins:mins||(kind==='quick'?2:60),start:null,schedDate:null};
  day().tasks.push(t);
  save();
  return t.id;   // callers (e.g. Fire Station "Queue a fire") record the new id
}
/* Mark a standalone day-task complete on the spot, stamping the time it happened.
   Used by capture's "already done" tick, so logging something you've just finished
   never has to appear in the open list first. The task is ordinary afterwards:
   un-ticking returns it to the open list, and it sweeps into the archive normally.
   doneAt here is a TIME (HH:MM), matching the archive's convention for standalone
   tasks — project tasks stamp a day key instead (see setProjTaskDone). */
function markTaskDoneNow(id){
  const t=day().tasks.find(x=>x.id===id);
  if(!t) return false;
  t.done=true;
  t.doneAt=nowHM();
  save(false);
  return true;
}
/* ---------- "Plan this" ----------
   Projects, meetings and leaks all carry the same small action: it creates an
   ORDINARY quick task titled "Plan: <name>" and nothing else. No planning store,
   no planning screen — the task then behaves like any other one (All Tasks,
   priority, pipeline, fire), which is the whole point.
   Tapping it again while that task is still open must not fork a duplicate. */
function planTaskTitle(name){ return 'Plan: '+String(name??'').trim(); }
/* an OPEN plan task for this name, searched across every day record: unfinished
   tasks are MOVED forward into today (see day()), but a stale one can still sit on
   an older day if the app hasn't been opened since. */
function findOpenPlanTask(name){
  const want=planTaskTitle(name).toLowerCase();
  for(const dk of Object.keys(S.days||{})){
    const t=(S.days[dk].tasks||[]).find(x=>!x.done && String(x.txt||'').trim().toLowerCase()===want);
    if(t) return {t,dayKey:dk};
  }
  return null;
}
/* Create the plan task unless one is already open. Returns true if it created one.
   The extra save(false) re-arms the debounced push WITHOUT its "Saved ✓" toast, so
   the message below is the one that actually stays on screen. */
function planThis(name){
  const v=String(name??'').trim(); if(!v) return false;
  if(findOpenPlanTask(v)){ toast('Already on your list — '+planTaskTitle(v)); return false; }
  addTask(planTaskTitle(v),'quick',QUICK_LIMIT);
  save(false);
  toast('Added — '+planTaskTitle(v));
  return true;
}

function archiveCompleted(){
  const d=day();
  const done=d.tasks.filter(t=>t.done);
  done.forEach(t=>d.archive.push({id:t.id,txt:t.txt,kind:t.kind,mins:t.mins,doneAt:nowHM()}));
  d.tasks=d.tasks.filter(t=>!t.done);
  save();
}
function week(){
  const k=weekKey();
  if(!S.weeks[k]) S.weeks[k]={ review:{}, scores:{} };
  return S.weeks[k];
}


/* ---------- external ops (voice / MCP connector) ----------
   The MCP server writes a task change into the state inside a transaction AND logs
   it to users/{uid}.extOps — a sibling field this app's own writes never touch. If
   this device's whole-state write landed on top of the server's (its save was
   already queued), the change is gone from the state but still in the log, so
   every cloud snapshot replays what this state hasn't recorded in S.extApplied.
   applyExtOp is the SAME function the server ran (state-core.js), so replay can't
   disagree with it; S.extApplied (a list of {id, ts}) makes it once-only, so a
   voice task you later delete is never resurrected. Returns true if S changed. */
function replayExtOps(ops){
  if(!Array.isArray(ops) || !ops.length) return false;
  const applied=extAppliedList(S);                 // state-core.js — an ARRAY, see why there
  const seen=new Set(applied.map(x=>x.id));
  const todo=ops.filter(op=>op && op.id && !seen.has(op.id))
                .sort((a,b)=>(+a.ts||0)-(+b.ts||0));
  if(!todo.length) return false;
  todo.forEach(op=>{
    try{ applyExtOp(S, op, {todayKey:todayKey(), today:day}); }
    catch(e){ console.warn('external op failed to apply', op.id, e); }
    applied.push({id:op.id, ts:+op.ts||Date.now()});   // recorded either way: an op is tried once
  });
  S.extApplied=applied;
  return true;
}
