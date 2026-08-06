/* ============================================================
   UNIFIED CAPTURE — one line in, then choose where it goes.

   This is the app's single general entry point. Type the thing first; decide
   its destination second. Enter alone routes to a QUICK TASK — that's the
   highest-volume capture and it must stay type-Enter-done. The chips are there
   for when it belongs somewhere else, never a toll on the common case.

   Purely a front-end consolidation: every destination hands off to the exact
   function the old standalone input called, so there are no new stores, no new
   fields and no second write path.
     Quick task      → addTask()                (tasks.js)
     Project task    → addUnifiedTask()         (page-today.js)
     Meeting item    → createMeetingPoint()     (page-meetings.js)
     Appointment     → createAppointment()      (page-appointments.js)
     Leak            → leakSubmit()             (page-leaks.js, incl. its
                                                 similarity / increment prompt)

   Nothing is written until the terminal action of a destination, so backing out
   of a second field writes nothing at all. The one exception is Leak: picking it
   commits to ASKING (the "same as…?" prompt), which is pre-existing behaviour —
   the text lives in leakPending, so neither answer can lose it.

   The Fire Station's in-fire capture row is deliberately NOT part of this — it
   stays isolated so it can never disturb an active session.
   ============================================================ */

/* transient draft only — never persisted, never part of S.
   projectId/meetingId: undefined = not chosen yet, null = "no project". */
let capDraft={ text:'', dest:null, projectId:undefined, meetingId:undefined, date:'', time:'' };
let capModalOpen=false;   // the Leak CTA popup (a second mount of this same control)

const CAP_DESTS=[
  ['quick','⚡','Quick task'],
  ['project','▣','Project task'],
  ['meeting','◇','Meeting item'],
  ['appt','📅','Appointment'],
  ['leak','💧','Leak'],
];

/* The modal is only really open if it's on screen — Escape and backdrop clicks go
   through closeReset(), which doesn't know about our flag. Deriving it from the DOM
   keeps ownership of the leak prompt honest after either of those. */
function capModalIsOpen(){
  const m=document.getElementById('resetModal');
  return !!(capModalOpen && m && m.classList.contains('show'));
}
function captureRoot(inModal){ return inModal ? q('#capModalBody') : q('#capCard'); }
function capDestNeedsMore(d){ return d==='project'||d==='meeting'||d==='appt'; }

function captureHint(){
  switch(capDraft.dest){
    case 'project': return 'Pick a project — or a standalone time block';
    case 'meeting': return 'Pick a meeting';
    case 'appt':    return 'Pick a date and time';
    case 'leak':    return 'Enter captures it as a leak';
    case 'quick':   return 'Enter adds it to Quick';
    default:        return 'Enter adds a quick task · or pick a destination';
  }
}

/* the second field, and only for the destinations that need one */
function captureStepHTML(){
  const back=`<button class="cap-back" data-capback>← back</button>`;
  if(capDraft.dest==='project'){
    const active=(S.projects||[]).filter(p=>!p.done);
    return `<div class="cap-step">
      <div class="cap-step-lbl">Which project?</div>
      <div class="cap-chips">
        ${active.map(p=>`<button class="cap-chip" data-capproj="${p.id}">${esc(p.name)}</button>`).join('')}
        <button class="cap-chip cap-chip-none" data-capproj="">No project · time block</button>
      </div>
      ${back}
    </div>`;
  }
  if(capDraft.dest==='meeting'){
    const ms=S.meetings||[];
    return `<div class="cap-step">
      <div class="cap-step-lbl">Which meeting?</div>
      ${ms.length
        ? `<div class="cap-chips">${ms.map(m=>`<button class="cap-chip" data-capmtg="${m.id}">${esc(m.name)}</button>`).join('')}</div>`
        : `<div class="cap-step-empty">No meetings yet — add one from the Meetings strip below.</div>`}
      ${back}
    </div>`;
  }
  if(capDraft.dest==='appt'){
    const tk=todayKey();
    return `<div class="cap-step">
      <div class="cap-step-lbl">When?</div>
      <div class="cap-when">
        <input type="date" data-capdate min="${tk}" value="${esc(capDraft.date||tk)}">
        <input type="time" data-captime value="${esc(capDraft.time||'')}">
        <button class="btn sm" data-capgo>Add</button>
      </div>
      ${back}
    </div>`;
  }
  return '';
}

function captureInnerHTML(inModal){
  leakAdoptStrandedPending('dash');   // a prompt stranded by an ended fire lands here
  const owns = inModal ? capModalIsOpen() : !capModalIsOpen();
  const prompt = (leakPending && leakPending.surface==='dash' && owns) ? leakConfirmHTML(leakPending) : '';
  const chip=([k,ic,lbl])=>`<button class="cap-chip cap-dest ${capDraft.dest===k?'on':''} cap-dest-${k}" data-capdest="${k}">${ic} ${lbl}</button>`;
  return `
    ${prompt}
    <div class="cap-row">
      <input type="text" data-capinput value="${esc(capDraft.text)}" placeholder="Capture anything — Enter for a quick task">
      <button class="btn" data-capgo>Add</button>
    </div>
    <div class="cap-chips cap-dests">${CAP_DESTS.map(chip).join('')}</div>
    ${captureStepHTML()}
    <div class="cap-hint">${captureHint()}</div>`;
}

/* ---------- the dashboard mount ---------- */
function renderCapture(){
  return `<div class="card cap-card" id="capCard">${captureInnerHTML(false)}</div>`;
}
function bindCapture(){ bindCaptureIn(captureRoot(false), false); }

/* ---------- the popup mount (Leak CTA) ---------- */
function openCaptureModal(dest){
  capModalOpen=true;
  capDraft.dest=dest||null; capDraft.projectId=undefined; capDraft.meetingId=undefined;
  renderCaptureModal();
}
function renderCaptureModal(){
  const m=q('#resetModal'); if(!m) return;
  const title = capDraft.dest==='leak' ? '💧 Capture a leak' : 'Capture';
  m.innerHTML=`<div class="modal cap-modal">
    <span class="modal-close" id="capModalClose">×</span>
    <h3>${title}</h3>
    <div id="capModalBody">${captureInnerHTML(true)}</div>
  </div>`;
  m.classList.add('show');
  const cl=q('#capModalClose'); if(cl) cl.onclick=closeCaptureModal;
  bindCaptureIn(captureRoot(true), true);
  const i=q('#capModalBody [data-capinput]'); if(i) i.focus();
}
function closeCaptureModal(){ capModalOpen=false; closeReset(); rerender(); }

/* repaint whichever mount is live, keeping the draft on screen */
function captureAfter(inModal){ if(inModal && capModalIsOpen()) renderCaptureModal(); else rerender(); }

function bindCaptureIn(root, inModal){
  if(!root) return;
  const after=()=>captureAfter(inModal);
  const input=root.querySelector('[data-capinput]');
  // typing never re-renders — the chips are always on screen, so there's nothing
  // to reveal and the caret is never yanked mid-word
  if(input){
    input.oninput=()=>{ capDraft.text=input.value; };
    input.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); captureCommit(inModal); } };
  }
  root.querySelectorAll('[data-capgo]').forEach(el=>el.onclick=()=>captureCommit(inModal));

  // destination chips: quick / leak commit straight away, the rest open one field
  root.querySelectorAll('[data-capdest]').forEach(el=>el.onclick=()=>{
    const d=el.dataset.capdest;
    capDraft.text=(input?input.value:capDraft.text);
    capDraft.dest=(capDraft.dest===d && capDestNeedsMore(d)) ? null : d;
    capDraft.projectId=undefined; capDraft.meetingId=undefined;
    if(!capDestNeedsMore(capDraft.dest) && (capDraft.text||'').trim()) captureCommit(inModal);
    else after();
  });

  // second-field pickers — choosing IS the commit
  root.querySelectorAll('[data-capproj]').forEach(el=>el.onclick=()=>captureCommit(inModal, {projectId: el.dataset.capproj || null}));
  root.querySelectorAll('[data-capmtg]').forEach(el=>el.onclick=()=>captureCommit(inModal, {meetingId: el.dataset.capmtg}));
  const di=root.querySelector('[data-capdate]'); if(di) di.oninput=()=>{ capDraft.date=di.value; };
  const ti=root.querySelector('[data-captime]'); if(ti) ti.oninput=()=>{ capDraft.time=ti.value; };

  // back out of a second field: destination clears, TEXT SURVIVES, nothing written
  root.querySelectorAll('[data-capback]').forEach(el=>el.onclick=()=>{
    capDraft.text=(input?input.value:capDraft.text);
    capDraft.dest=null; capDraft.projectId=undefined; capDraft.meetingId=undefined;
    after();
  });

  // the leak "same as…?" prompt, when this mount owns it
  bindLeakCaptureIn(root, 'dash', after);
}

function captureReset(){ capDraft={ text:'', dest:null, projectId:undefined, meetingId:undefined, date:'', time:'' }; }

/* Commit to the chosen destination — or to a quick task when none is chosen.
   Returns without writing anything when a destination still needs its field. */
function captureCommit(inModal, extra){
  const root=captureRoot(inModal);
  const input=root && root.querySelector('[data-capinput]');
  const txt=(((input?input.value:capDraft.text))||'').trim();
  if(extra){ if('projectId' in extra) capDraft.projectId=extra.projectId; if('meetingId' in extra) capDraft.meetingId=extra.meetingId; }
  if(!txt){ capDraft.text=''; if(input) input.focus(); return; }
  capDraft.text=txt;
  const d=capDraft.dest||'quick';           // ← Enter with nothing chosen = quick task

  if(d==='quick'){
    addTask(txt,'quick',2);
    captureDone(inModal,'Quick task added');
    return;
  }
  if(d==='project'){
    if(capDraft.projectId===undefined){ toast('Pick a project'); return; }
    // 60 min is the default; adjust it on the row with the existing duration picker
    addUnifiedTask(txt,'project',capDraft.projectId,60);
    captureDone(inModal, capDraft.projectId?'Added to project':'Time block added');
    return;
  }
  if(d==='meeting'){
    if(!capDraft.meetingId){ toast('Pick a meeting'); return; }
    if(!createMeetingPoint(capDraft.meetingId, txt)){ toast('That meeting is gone'); return; }
    captureDone(inModal,'Talking point added');
    return;
  }
  if(d==='appt'){
    // read the fields live: the date input renders defaulted to today, so trusting
    // capDraft.date alone would reject a commit the user can plainly see is filled in
    const de=root && root.querySelector('[data-capdate]');
    const te=root && root.querySelector('[data-captime]');
    const date=(((de?de.value:capDraft.date))||'').trim();
    const time=(((te?te.value:capDraft.time))||'').trim();
    if(!date || !time){ toast('Pick a date and time'); return; }
    createAppointment(txt, date, time);
    save();
    captureDone(inModal,'Appointment added');
    return;
  }
  if(d==='leak'){
    // leakSubmit toasts on an outright capture; on a near-match it raises the
    // "same as…?" prompt instead and the text is held in leakPending
    const captured=leakSubmit(txt,'dash');
    capDraft.text=''; capDraft.dest = captured ? null : 'leak';
    if(inModal && capModalIsOpen()){
      if(captured) closeCaptureModal(); else renderCaptureModal();   // stay open to answer
    }else{
      rerender(); captureRefocus();
    }
    return;
  }
}
/* clear the draft, repaint, and put the caret back for the next capture */
function captureDone(inModal, msg){
  captureReset();
  if(inModal && capModalIsOpen()){ closeCaptureModal(); }
  else { rerender(); captureRefocus(); }
  toast(msg);
}
function captureRefocus(){
  setTimeout(()=>{ const i=q('#capCard [data-capinput]'); if(i) i.focus(); },0);
}
