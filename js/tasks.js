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
function poolUnscheduled(){ return allTimeBlockTasks().filter(e=>e.t.schedDate==null && !e.t.done); }
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
  if(t) t.done=done;
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
  day().tasks.push({id:b(),txt,kind,done:false,mins:mins||(kind==='quick'?2:60),start:null,schedDate:null});
  save();
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

