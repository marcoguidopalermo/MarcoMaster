/* ---------- recurring cadence engine ----------
   A recurring task has one of three schedule modes:
   - mode:'everyN'    => every `every` days since last completion (1=daily)
   - mode:'weekdays'  => due on specific days of week, dows:[0..6] (0=Sun)
   - mode:'monthDay'  => due on a calendar date each month, dom:1..31
   Back-compat: tasks with only `every` are treated as everyN.            */
function daysBetween(aKey,bKey){
  const [ay,am,ad]=aKey.split('-').map(Number), [by,bm,bd]=bKey.split('-').map(Number);
  const a=new Date(ay,am-1,ad), b2=new Date(by,bm-1,bd);
  return Math.round((b2-a)/86400000);
}
function dateFromKey(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
const DOW_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function recMode(r){ return r.mode || 'everyN'; }

function cadenceLabel(r){
  const m=recMode(r);
  if(m==='weekdays'){
    const ds=(r.dows||[]).slice().sort();
    if(ds.length===7) return 'every day';
    if(ds.length===0) return 'no days set';
    // recognise common combos
    if(ds.join()==='1,2,3,4,5') return 'weekdays (Mon–Fri)';
    if(ds.join()==='0,6') return 'weekends';
    return ds.map(d=>DOW_NAMES[d]).join(', ');
  }
  if(m==='monthDay'){
    if(r.dom==='last') return 'last day of month';
    const d=r.dom||1; const suf=(d%10===1&&d!==11)?'st':(d%10===2&&d!==12)?'nd':(d%10===3&&d!==13)?'rd':'th';
    return `${d}${suf} of month`;
  }
  // everyN
  const n=r.every||1;
  if(n===1) return 'daily';
  if(n===7) return 'weekly';
  if(n===14) return 'every 2 weeks';
  if(n===30) return 'monthly';
  if(n===90) return 'quarterly';
  return `every ${n} days`;
}

function recurringDue(r,k){
  k=k||todayKey();
  if(r.snoozeUntil && r.snoozeUntil>k) return false;   // snoozed
  const m=recMode(r);
  const today=dateFromKey(k);
  if(m==='weekdays'){
    const dows=r.dows||[];
    if(!dows.includes(today.getDay())) return false;
    // don't re-fire if already completed today
    return r.last!==k;
  }
  if(m==='monthDay'){
    const dim=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
    const target=(r.dom==='last')?dim:Math.min(r.dom||1,dim);
    if(today.getDate()!==target) return false;
    return r.last!==k;
  }
  // everyN
  if(!r.last) return true;
  return daysBetween(r.last,k) >= (r.every||1);
}

/* next-due label for the manager view */
function nextDueLabel(r){
  const k=todayKey();
  if(r.snoozeUntil && r.snoozeUntil>k) return 'snoozed → '+prettyKeyShort(r.snoozeUntil);
  if(recurringDue(r)) return 'due today';
  const m=recMode(r);
  if(m==='weekdays'){
    const dows=(r.dows||[]).slice().sort();
    if(!dows.length) return 'no days set';
    const todayDow=dateFromKey(k).getDay();
    for(let i=1;i<=7;i++){ if(dows.includes((todayDow+i)%7)) return i===1?'due tomorrow':`due ${DOW_NAMES[(todayDow+i)%7]}`; }
    return 'scheduled';
  }
  if(m==='monthDay'){
    const t=dateFromKey(k);
    const dim=new Date(t.getFullYear(),t.getMonth()+1,0).getDate();
    const target=(r.dom==='last')?dim:Math.min(r.dom||1,dim);
    if(t.getDate()<target){ const diff=target-t.getDate(); return diff===1?'due tomorrow':`due in ${diff}d`; }
    return r.dom==='last'?'due end of next month':'due next month';
  }
  // everyN
  if(!r.last) return 'due today';
  const remain=(r.every||1)-daysBetween(r.last,k);
  if(remain<=0) return 'due today';
  if(remain===1) return 'due tomorrow';
  return `due in ${remain}d`;
}
function prettyKeyShort(k){ const [y,m,dd]=k.split('-'); return new Date(y,m-1,dd).toLocaleDateString('en-CA',{month:'short',day:'numeric'}); }

function dueRecurring(){ return S.recurring.filter(r=>r.auto!==false && recurringDue(r)); }

/* auto-add due recurring tasks into today's inbox (once per day, idempotent) */
function syncRecurringIntoToday(){
  if(S.settings && S.settings.autoAddRecurring===false) return;
  const d=day();
  if(!d.recurringAdded) d.recurringAdded={};
  dueRecurring().forEach(r=>{
    if(d.recurringAdded[r.id]) return;
    if(d.skipped && d.skipped[r.id]) return;
    d.tasks.push({id:b(),txt:r.t,kind:r.kind||'quick',done:false,mins:r.kind==='project'?60:2,start:null,recurringId:r.id});
    d.recurringAdded[r.id]=true;
  });
}
function markRecurringDone(recurringId){
  const r=S.recurring.find(x=>x.id===recurringId);
  if(r){ r.last=todayKey(); if(r.snoozeUntil) delete r.snoozeUntil; }
}
