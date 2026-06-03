/* ============================================================
   MEETINGS — recurring people / meetings (Manager, Mechanic, James…).
   Persistent like Projects: they stay until deleted. Each meeting holds
   a checkable list of TALKING POINTS (jot something to raise, check it
   off when covered) plus a free NOTES area for open context. Modeled on
   the Projects page (list of cards + add-input + per-item check/delete).
   Item: { id, name, points:[{id,txt,done}], notes:"", createdAt }
   ============================================================ */
let newMeetingName='';
let meetingDraftText={};   // {meetingId: in-progress new talking-point text}

function meetingStats(m){
  const pts=m.points||[];
  return {total:pts.length, done:pts.filter(p=>p.done).length};
}

function renderMeetings(){
  const meetings=S.meetings||[];
  const card=(m)=>{
    const pts=m.points||[];
    const s=meetingStats(m);
    return `
    <div class="proj-card meeting-card">
      <div class="proj-bar-top">
        <input type="text" class="proj-name-in" data-mname="${m.id}" value="${esc(m.name)}">
        <span class="proj-stat">${s.done}/${s.total}</span>
        <span class="x" data-mdel="${m.id}">×</span>
      </div>

      <div class="mtg-section-lbl">Talking points</div>
      <div class="proj-tasks">
        ${pts.length?pts.map(p=>`
          <div class="ptask-row ${p.done?'done':''}">
            <span class="box" data-mpdone="${m.id}|${p.id}">✓</span>
            <span class="ptxt">${esc(p.txt)}</span>
            <span class="x" data-mpdel="${m.id}|${p.id}">×</span>
          </div>`).join(''):'<div class="empty sm">No talking points yet.</div>'}
      </div>
      <div class="proj-add-task">
        <input type="text" data-mpadd="${m.id}" value="${esc(meetingDraftText[m.id]||'')}" placeholder="Add a talking point for ${esc(m.name)}...">
        <button class="btn sm" data-mpaddbtn="${m.id}">+</button>
      </div>

      <div class="mtg-section-lbl">Notes</div>
      <textarea class="mtg-notes" data-mnotes="${m.id}" placeholder="Open notes / context for ${esc(m.name)}…">${esc(m.notes||'')}</textarea>
    </div>`;
  };
  return `
  <div class="phead">
    <div class="kicker">People &amp; recurring meetings</div>
    <h2>Meetings</h2>
    <p>Jot talking points as they come up, check them off when covered, and keep running notes per person.</p>
  </div>

  <div class="proj-stack">
    ${meetings.length?meetings.map(card).join(''):'<div class="empty">No meetings yet. Add one below.</div>'}
  </div>

  <div class="card" style="margin-top:16px">
    <div class="proj-add">
      <input type="text" id="newMeeting" value="${esc(newMeetingName)}" placeholder="New meeting or person (e.g. Manager, Mechanic, James)...">
      <button class="btn" id="addMeeting">Add</button>
    </div>
  </div>
  `;
}

function bindMeetings(){
  // rename meeting (save without re-render so typing doesn't jump)
  q('[data-mname]','all').forEach(el=>el.oninput=()=>{ const m=(S.meetings||[]).find(x=>x.id===el.dataset.mname); if(m){ m.name=el.value; save(); } });
  // delete meeting
  q('[data-mdel]','all').forEach(el=>el.onclick=()=>{
    const m=(S.meetings||[]).find(x=>x.id===el.dataset.mdel); if(!m) return;
    if(confirm(`Delete meeting "${m.name}" and its talking points + notes?`)){
      S.meetings=(S.meetings||[]).filter(x=>x.id!==m.id); save(); rerender();
    }
  });
  // free-notes autosave (no re-render — keep the caret where it is)
  q('[data-mnotes]','all').forEach(el=>el.oninput=()=>{ const m=(S.meetings||[]).find(x=>x.id===el.dataset.mnotes); if(m){ m.notes=el.value; save(); } });

  // talking point: check / uncheck
  q('[data-mpdone]','all').forEach(el=>el.onclick=()=>{
    const [mid,pid]=el.dataset.mpdone.split('|');
    const m=(S.meetings||[]).find(x=>x.id===mid); const p=m&&(m.points||[]).find(x=>x.id===pid);
    if(p){ p.done=!p.done; save(false); rerender(); }
  });
  // talking point: delete
  q('[data-mpdel]','all').forEach(el=>el.onclick=()=>{
    const [mid,pid]=el.dataset.mpdel.split('|');
    const m=(S.meetings||[]).find(x=>x.id===mid); if(m){ m.points=(m.points||[]).filter(x=>x.id!==pid); save(); rerender(); }
  });
  // talking point: add (draft on input, commit on Enter / +)
  q('[data-mpadd]','all').forEach(el=>el.oninput=()=>{ meetingDraftText[el.dataset.mpadd]=el.value; });
  q('[data-mpadd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter') addMeetingPoint(el.dataset.mpadd); });
  q('[data-mpaddbtn]','all').forEach(el=>el.onclick=()=>addMeetingPoint(el.dataset.mpaddbtn));

  // add a meeting
  const ni=q('#newMeeting'); if(ni) ni.oninput=()=>{ newMeetingName=ni.value; };
  const add=q('#addMeeting'); if(add) add.onclick=()=>{
    const v=(newMeetingName||'').trim(); if(!v) return;
    if(!S.meetings) S.meetings=[];
    S.meetings.push({id:b(), name:v, points:[], notes:'', createdAt:Date.now()});
    newMeetingName=''; save(); rerender();
  };
  if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addMeeting').click(); };
}

function addMeetingPoint(mid){
  const m=(S.meetings||[]).find(x=>x.id===mid); if(!m) return;
  const v=(meetingDraftText[mid]||'').trim(); if(!v) return;
  if(!m.points) m.points=[];
  m.points.push({id:b(), txt:v, done:false});
  meetingDraftText[mid]=''; save(); rerender();
}

/* ============================================================
   DASHBOARD — at-a-glance Meetings strip, mirroring Active Projects.
   Each meeting is a compact card (name + talking-point progress); tap
   opens a modal with the checkable points + notes. Full management
   stays on the Meetings tab. Reuses the project-card-mini visual +
   the project-modal pattern, on the meetings data.
   ============================================================ */
function renderDashMeetings(){
  const meetings=S.meetings||[];
  return `
  <div class="card dash-projects">
    <div class="card-h"><h3>Meetings</h3><span class="sub">${meetings.length}</span></div>
    ${meetings.length?`<div class="proj-strip">
      ${meetings.map(m=>{ const s=meetingStats(m); const pct=s.total?Math.round(s.done/s.total*100):0; return `
        <button class="proj-card-mini" data-mtgopen="${m.id}">
          <span class="pcm-top"><span class="proj-swatch" style="background:var(--accent)"></span><span class="pcm-name">${esc(m.name)}</span></span>
          <div class="proj-track"><div class="proj-fill" style="width:${pct}%;background:var(--accent)"></div></div>
          <span class="pcm-count">${s.done}/${s.total} covered</span>
        </button>`; }).join('')}
    </div>`:'<div class="empty sm">No meetings — add one in the Meetings tab.</div>'}
  </div>`;
}

/* ---------- meeting quick-view modal (mirrors the project task modal) ---------- */
let meetingModalId=null;
let meetingModalDraft='';
function openMeetingModal(mid){ meetingModalId=mid; meetingModalDraft=''; renderMeetingModal(); }
function renderMeetingModal(){
  const m=(S.meetings||[]).find(x=>x.id===meetingModalId); if(!m){ closeReset(); return; }
  const pts=m.points||[];
  const el=q('#resetModal');
  el.innerHTML=`
    <div class="modal">
      <span class="modal-close" id="mmClose">×</span>
      <h3><span class="proj-swatch" style="background:var(--accent);display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(m.name)}</h3>
      <div class="mtg-section-lbl">Talking points</div>
      <div class="pm-tasks">
        ${pts.length?pts.map(p=>`
          <div class="pm-row ${p.done?'done':''}">
            <span class="box" data-mmdone="${p.id}">✓</span>
            <span class="pm-txt">${esc(p.txt)}</span>
            <span class="x" data-mmdel="${p.id}">×</span>
          </div>`).join(''):'<div class="empty sm">No talking points yet — add one below.</div>'}
      </div>
      <div class="proj-add-task" style="margin-top:12px">
        <input type="text" id="mmAdd" value="${esc(meetingModalDraft)}" placeholder="Add a talking point for ${esc(m.name)}…">
        <button class="btn sm" id="mmAddBtn">+ Add</button>
      </div>
      <div class="mtg-section-lbl">Notes</div>
      <textarea class="mtg-notes" id="mmNotes" placeholder="Open notes / context for ${esc(m.name)}…">${esc(m.notes||'')}</textarea>
      <p class="list-note" style="margin-top:10px">Quick view · full management on the Meetings tab</p>
    </div>`;
  el.classList.add('show');
  bindMeetingModal();
}
function bindMeetingModal(){
  const m=(S.meetings||[]).find(x=>x.id===meetingModalId); if(!m) return;
  const close=q('#mmClose'); if(close) close.onclick=()=>{ meetingModalId=null; closeReset(); };
  // re-render the modal AND the dashboard strip on every change (rerender only rebuilds #main)
  q('[data-mmdone]','all').forEach(el=>el.onclick=()=>{ const p=(m.points||[]).find(x=>x.id===el.dataset.mmdone); if(p){ p.done=!p.done; save(false); renderMeetingModal(); rerender(); } });
  q('[data-mmdel]','all').forEach(el=>el.onclick=()=>{ m.points=(m.points||[]).filter(x=>x.id!==el.dataset.mmdel); save(); renderMeetingModal(); rerender(); });
  const ai=q('#mmAdd'); if(ai) ai.oninput=()=>{ meetingModalDraft=ai.value; };
  const addP=()=>{ const v=(meetingModalDraft||'').trim(); if(!v) return; if(!m.points) m.points=[]; m.points.push({id:b(),txt:v,done:false}); meetingModalDraft=''; save(); renderMeetingModal(); rerender(); };
  const ab=q('#mmAddBtn'); if(ab) ab.onclick=addP;
  if(ai) ai.onkeydown=e=>{ if(e.key==='Enter') addP(); };
  const nt=q('#mmNotes'); if(nt) nt.oninput=()=>{ m.notes=nt.value; save(); };   // autosave; no re-render (keep caret)
}
