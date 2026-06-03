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
