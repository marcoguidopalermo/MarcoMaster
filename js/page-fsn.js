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
let dayScreenGated=false;   // true = the first-open-of-the-day gate (see maybeOpenMorning)
let mrnView='full';         // 'full' | 'condensed' | 'principles' — independent of fsnView

/* ---------- the once-a-day gate ----------
   The morning screen opens BY ITSELF on the first app open of a day, and the only
   way past it is writing one line. No timer, no countdown, no forced wait — and
   deliberately no memory beyond today: nothing counts missed mornings, nothing
   displays a streak, nothing nags. A day you skip simply isn't recorded.

   "Done" is d.morningSeen, plus an already-written intention as a second signal —
   so a day where you wrote your intention in the Journal first never ambushes you
   with the gate afterwards. */
function morningDone(d){
  if(!d) return true;
  return !!(d.morningSeen || String((d.morning&&d.morning.intentions)||'').trim());
}
/* Called once from startApp(), after the dashboard has rendered behind it. */
function maybeOpenMorning(){
  if(morningDone(day())) return false;
  openMorningGate();
  return true;
}
function openMorningGate(){ dayScreenOpen=true; dayScreenGated=true; mrnView='full'; paintDayScreen(); }
function openDayScreen(){ dayScreenOpen=true; dayScreenGated=false; mrnView='full'; paintDayScreen(); }
/* Gated, the screen cannot be dismissed — Escape, the × and this all no-op until
   the line is written. Writing it is the exit, which is the whole point. */
function closeDayScreen(){
  if(dayScreenGated) return false;
  dayScreenOpen=false; paintDayScreen(); rerender(); return true;
}
/* The gate's exit: stamp the day as seen and drop into the dashboard. The intent
   itself is already saved — the field writes through on every keystroke. */
function morningContinue(){
  const v=String(morningIntent()).trim();
  if(!v) return false;                       // the button is disabled too; this is the backstop
  const d=day();
  d.morning=d.morning||{};
  d.morning.intentions=v;
  d.morningSeen=true;
  save();
  dayScreenGated=false;
  dayScreenOpen=false;
  paintDayScreen(); rerender();
  return true;
}
function morningIntent(){ const d=day(); return (d.morning&&d.morning.intentions)||''; }

/* If the gate is open and untouched when a NEWER cloud state arrives that already
   has this morning done (you wrote it on your phone, then opened the laptop), let
   it go rather than asking twice. Only when the field is still empty — never yank
   the screen out from under something being typed. */
function morningReconcile(){
  if(!dayScreenOpen || !dayScreenGated) return;
  if(String(morningIntent()).trim()) return;
  if(!morningDone(day())) return;
  dayScreenGated=false; dayScreenOpen=false;
  paintDayScreen();
}

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


/* today's appointments, in time order — not-done only; nothing here is actionable */
function morningAppts(){
  const tk=todayKey();
  return (S.appointments||[]).filter(a=>a && a.date===tk && !a.done)
    .sort((a,b)=>(a.time||'').localeCompare(b.time||''));
}

/* ---------- the share line ----------
   Plain text for a message app: no markdown, no emoji, nothing that reads oddly
   once pasted into iMessage or WhatsApp. */
function morningShareText(){
  const lines=['Today’s intent: '+String(morningIntent()).trim()];
  const pipe=morningPipeline();
  if(pipe.length){
    lines.push('');
    lines.push('My three today:');
    pipe.forEach((it,i)=>lines.push((i+1)+'. '+String(it.txt).trim()));
  }
  return lines.join('\n');
}
async function morningShare(){
  const txt=morningShareText();
  const ok=await copyToClipboard(txt);
  toast(ok?'Copied — paste it to whoever keeps you honest':'Could not copy — select and copy manually');
}

function dayScreenHTML(){
  const n=S.narrative||{full:'',condensed:'',principles:''};
  if(!FSN_TABS.some(([k])=>k===mrnView)) mrnView='full';
  const body=fsnTextHtml(n[mrnView]);
  const label=(FSN_TABS.find(([k])=>k===mrnView)||[])[1]||'';
  const pipe=morningPipeline();
  const appts=morningAppts();
  const tk=todayKey();
  const rest=(typeof trainIsRest==='function') && trainIsRest(tk);
  const sessions=(typeof trainDaySessions==='function') ? trainDaySessions(tk) : [];
  const intent=morningIntent();
  const vb=(S.visionBoard&&S.visionBoard.url)||'';   // lights up when a board is set; absent = nothing renders
  const block=(lbl, inner)=>`<div class="mrn-block"><div class="mrn-lbl">${lbl}</div>${inner}</div>`;

  return `<div class="pick-inner mrn-inner ${dayScreenGated?'is-gated':''}">
    ${dayScreenGated?'':`<button class="pick-close mrn-close" id="dayScreenClose" title="Close">×</button>`}

    <div class="mrn-head">
      <div class="mrn-date">${esc(prettyDate())}</div>
      <div class="mrn-line">${esc(morningSummary())}</div>
    </div>

    ${vb?`<div class="mrn-vision"><img src="${esc(vb)}" alt="Vision board" onerror="this.closest('.mrn-vision').style.display='none'"></div>`:''}

    ${appts.length?block('Appointments', `<div class="mrn-rows">${appts.map(a=>
      `<div class="mrn-row"><span class="mrn-t">${esc(fmtClock(a.time)||'—')}</span><span>${esc(a.title)}</span></div>`).join('')}</div>`):''}

    ${rest
      ? block('Training', `<div class="mrn-rows"><div class="mrn-row"><span>Rest day. Nothing owed.</span></div></div>`)
      : (sessions.length?block('Training', `<div class="mrn-rows">${sessions.map(sn=>
          `<div class="mrn-row"><span class="mrn-t">${esc(sn.time?fmtClock(sn.time):'—')}</span><span>${esc(workoutTaskText(sn))}</span></div>`).join('')}</div>`):'')}

    ${pipe.length?block("Today's three", pipe.map((it,i)=>
      `<div class="mrn-focus"><span class="mrn-n">${i+1}</span><span>${esc(it.txt)}</span></div>`).join('')):''}

    <div class="mrn-intent">
      <label class="mrn-lbl" for="mrnIntent">Today's intent</label>
      <input type="text" id="mrnIntent" value="${esc(intent)}" autocomplete="off"
             placeholder="One line. What today is actually for.">
      <div class="mrn-actions">
        ${dayScreenGated
          ? `<button class="btn" id="mrnContinue" ${String(intent).trim()?'':'disabled'}>Continue →</button>`
          : `<button class="btn ghost" id="dayScreenDone">Close</button>`}
        <button class="btn ghost sm" id="mrnShare" ${String(intent).trim()?'':'disabled'}>Share today's intent</button>
      </div>
    </div>

    <div class="mrn-narrative">
      <div class="fsn-toggle mrn-toggle">
        ${FSN_TABS.map(([k,lbl])=>`<button class="fsn-tab ${mrnView===k?'active':''}" data-mrntab="${k}">${lbl}</button>`).join('')}
      </div>
      <div class="fsn-reader">
        ${body || `<div class="empty">No ${esc(label.toLowerCase())} narrative yet — write one in Settings → Future Self Narrative.</div>`}
      </div>
    </div>

    <div class="mrn-foot">${dayScreenGated
      ? 'Write the line and go. That’s the whole ritual.'
      : 'Close when you’re ready. Nothing here needs doing.'}</div>
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
  if(dayScreenGated){ const i=q('#mrnIntent'); if(i) i.focus(); }
}
function bindDayScreen(){
  const cl=q('#dayScreenClose'); if(cl) cl.onclick=closeDayScreen;
  const dn=q('#dayScreenDone');  if(dn) dn.onclick=closeDayScreen;
  // scoped to #dayScreen so this can never bind (or be bound by) the FSN page's
  // own toggle when both happen to be in the document
  q('#dayScreen [data-mrntab]','all').forEach(el=>el.onclick=()=>{ mrnView=el.dataset.mrntab; paintDayScreen(); });

  // The intent writes through on every keystroke — same contract as the journal's
  // own field, and it means a half-typed line survives a closed tab. NO repaint:
  // the caret must never move while you're writing the one thing this screen asks
  // for. The buttons' enabled state is toggled in place instead.
  const inp=q('#mrnIntent');
  if(inp){
    inp.oninput=()=>{
      const d=day(); d.morning=d.morning||{};
      d.morning.intentions=inp.value;
      save(false);
      const on=!!inp.value.trim();
      const c=q('#mrnContinue'); if(c) c.disabled=!on;
      const sh=q('#mrnShare');   if(sh) sh.disabled=!on;
    };
    inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); if(dayScreenGated) morningContinue(); else inp.blur(); } };
  }
  const co=q('#mrnContinue'); if(co) co.onclick=morningContinue;
  const sh=q('#mrnShare');    if(sh) sh.onclick=morningShare;
}
