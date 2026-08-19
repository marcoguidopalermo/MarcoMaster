/* ============================================================
   FUTURE SELF NARRATIVE (FSN) — a dedicated reading view.
   Built for READING, not managing: a comfortable measure, generous
   line height, calm typography. A toggle switches between the Full
   narrative, a Condensed version, and Principles. Editing lives in
   Settings; this view is where the morning re-read happens.
   ============================================================ */
let fsnView='full';   // 'full' | 'condensed' | 'principles'

const FSN_TABS=[
  ['full','Full'],
  ['condensed','Condensed'],
  ['principles','Principles'],
];

/* plain text → readable HTML: escape, blank lines split paragraphs, single
   newlines become <br> so line breaks and paragraphs survive intact. */
function fsnTextHtml(str){
  const t=(str||'').replace(/\r\n/g,'\n').trim();
  if(!t) return '';
  return t.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
}

function renderFSN(){
  const n=S.narrative||{full:'',condensed:'',principles:''};
  if(!FSN_TABS.some(([k])=>k===fsnView)) fsnView='full';
  const body=fsnTextHtml(n[fsnView]);
  const label=(FSN_TABS.find(([k])=>k===fsnView)||[])[1]||'';
  return `
  <div class="fsn-wrap">
    <div class="phead compact">
      <div class="kicker">Read this first</div>
      <h2>Future Self Narrative</h2>
    </div>
    <div class="fsn-toggle">
      ${FSN_TABS.map(([k,lbl])=>`<button class="fsn-tab ${fsnView===k?'active':''}" data-fsntab="${k}">${lbl}</button>`).join('')}
    </div>
    <div class="fsn-reader">
      ${body || `<div class="empty">No ${esc(label.toLowerCase())} narrative yet — write one in Settings → Future Self Narrative.</div>`}
    </div>
  </div>`;
}

function bindFSN(){
  q('[data-fsntab]','all').forEach(el=>el.onclick=()=>{ fsnView=el.dataset.fsntab; rerender(); });
}

/* ============================================================
   START YOUR DAY — the morning ritual screen.
   A full-screen overlay (#dayScreen, outside .app like every other .pick-screen)
   holding the narrative and a calm read of what today actually holds. It is
   DELIBERATELY inert: nothing here can be ticked, edited or dismissed-with-a-
   consequence. You read it, you close it, you go and do the day. Everything on it
   is actionable somewhere else — the dashboard is one Escape away.

   It reuses .pick-screen for the shell and the Escape chain, but NOT
   fitPickScreen(): that steps type down to avoid scrolling, which is exactly
   wrong for a reading view. A long narrative should scroll at a comfortable size,
   never shrink to fit.

   The reader itself is the FSN reader — same fsnTextHtml, same FSN_TABS, same
   .fsn-reader typography — so the morning re-read and the FSN page can never
   drift apart. It keeps its own tab state so switching to Principles here doesn't
   silently change what the FSN page shows.
   ============================================================ */
let dayScreenOpen=false;
let mrnView='full';   // 'full' | 'condensed' | 'principles' — independent of fsnView

function openDayScreen(){ dayScreenOpen=true; mrnView='full'; paintDayScreen(); }
function closeDayScreen(){ dayScreenOpen=false; paintDayScreen(); rerender(); }

/* today's appointments, workout and focus count in one calm line. Facts only —
   no counts of what's overdue, nothing framed as owed. */
function morningSummary(){
  const tk=todayKey();
  const bits=[];

  const appts=(S.appointments||[]).filter(a=>a && a.date===tk && !a.done)
    .sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  if(appts.length){
    const t=appts[0].time?fmtClock(appts[0].time):'';
    bits.push(appts.length===1
      ? ('One appointment'+(t?' at '+t:''))
      : (appts.length+' appointments'+(t?', first at '+t:'')));
  }else{
    bits.push('No appointments');
  }

  if(typeof trainIsRest==='function' && trainIsRest(tk)){
    bits.push('Rest day');
  }else if(typeof trainDaySessions==='function'){
    const list=trainDaySessions(tk);
    if(list.length) bits.push(list.map(s=>workoutTaskText(s)).join(' + '));
  }

  const pipe=morningPipeline();
  bits.push(pipe.length?(pipe.length+' focus'+(pipe.length===1?'':'es')+' set'):'No focus set yet');
  return bits.join(' · ');
}
/* the pipeline's three, as plain text — read-only here by design */
function morningPipeline(){
  return (day().pipeline||[]).filter(it=>it && String(it.txt||'').trim());
}

function dayScreenHTML(){
  const n=S.narrative||{full:'',condensed:'',principles:''};
  if(!FSN_TABS.some(([k])=>k===mrnView)) mrnView='full';
  const body=fsnTextHtml(n[mrnView]);
  const label=(FSN_TABS.find(([k])=>k===mrnView)||[])[1]||'';
  const pipe=morningPipeline();
  return `<div class="pick-inner mrn-inner">
    <button class="pick-close mrn-close" id="dayScreenClose" title="Close">×</button>

    <div class="mrn-head">
      <div class="mrn-date">${esc(prettyDate())}</div>
      <div class="mrn-line">${esc(morningSummary())}</div>
    </div>

    ${pipe.length?`
    <div class="mrn-three">
      <div class="mrn-lbl">Today's three</div>
      ${pipe.map((it,i)=>`<div class="mrn-focus"><span class="mrn-n">${i+1}</span><span>${esc(it.txt)}</span></div>`).join('')}
    </div>`:''}

    <div class="mrn-narrative">
      <div class="fsn-toggle mrn-toggle">
        ${FSN_TABS.map(([k,lbl])=>`<button class="fsn-tab ${mrnView===k?'active':''}" data-mrntab="${k}">${lbl}</button>`).join('')}
      </div>
      <div class="fsn-reader">
        ${body || `<div class="empty">No ${esc(label.toLowerCase())} narrative yet — write one in Settings → Future Self Narrative.</div>`}
      </div>
    </div>

    <div class="mrn-foot">Close when you're ready. Nothing here needs doing.</div>
  </div>`;
}

function paintDayScreen(){
  const el=q('#dayScreen'); if(!el) return;
  if(!dayScreenOpen){ el.classList.remove('show'); el.innerHTML=''; document.body.classList.remove('pick-open'); return; }
  el.innerHTML=dayScreenHTML();
  el.classList.add('show');
  document.body.classList.add('pick-open');
  bindDayScreen();
  el.scrollTop=0;          // always open at the top of the narrative
}
function bindDayScreen(){
  const cl=q('#dayScreenClose'); if(cl) cl.onclick=closeDayScreen;
  // scoped to #dayScreen so this can never bind (or be bound by) the FSN page's
  // own toggle when both happen to be in the document
  q('#dayScreen [data-mrntab]','all').forEach(el=>el.onclick=()=>{ mrnView=el.dataset.mrntab; paintDayScreen(); });
}
