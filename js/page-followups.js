/* ============================================================
   FOLLOW-UPS — persistent open loops (client follow-ups, waiting-ons).
   Not scheduled, not recurring: they stay until you resolve them.
   Modeled on the Projects page (list + add input + per-row actions + save).
   Item: { id, txt, note, createdAt, lastTouched, resolved }
   ============================================================ */
let newFollowupText='';
let followupsResolvedOpen=false;

/* how long it's been open, from lastTouched (falling back to createdAt) */
function followupAge(f){
  const since=f.lastTouched||f.createdAt||Date.now();
  const ms=Math.max(0, Date.now()-since);
  const d=Math.floor(ms/86400000);
  if(d>=1) return d+'d open';
  const h=Math.floor(ms/3600000);
  if(h>=1) return h+'h open';
  return 'today';
}
/* count of open follow-ups — reused by the Today reminder */
function openFollowupCount(){ return (S.followups||[]).filter(f=>!f.resolved).length; }

function renderFollowups(){
  const all=S.followups||[];
  const open=all.filter(f=>!f.resolved);
  const resolved=all.filter(f=>f.resolved);
  const row=(f)=>`
    <div class="fu-row">
      <span class="fu-dot">○</span>
      <div class="fu-main">
        <input type="text" class="fu-txt" data-futxt="${f.id}" value="${esc(f.txt)}" placeholder="Follow-up…">
        <input type="text" class="fu-note" data-funote="${f.id}" value="${esc(f.note||'')}" placeholder="add a note (optional)">
      </div>
      <span class="fu-age">${followupAge(f)}</span>
      <span class="fu-act touch" data-futouch="${f.id}" title="Touched today — followed up again">⟳</span>
      <span class="fu-act resolve" data-furesolve="${f.id}" title="Resolve">✓</span>
      <span class="x" data-fudel="${f.id}">×</span>
    </div>`;
  return `
  <div class="card fu-card">
    <div class="card-h"><h3>Follow-ups</h3><span class="sub">${open.length} open</span></div>
    <div class="proj-add fu-add">
      <input type="text" id="newFollowup" value="${esc(newFollowupText)}" placeholder="New follow-up (e.g. Chase invoice with Acme)…">
      <button class="btn" id="addFollowup">Add</button>
    </div>
    ${open.length?`<div class="fu-list">${open.map(row).join('')}</div>`:'<div class="empty">No open follow-ups — all loops closed. ✓</div>'}

    ${resolved.length?`
    <div class="panel ${followupsResolvedOpen?'open':''}" style="margin-top:12px">
      <button class="panel-h" data-fupanel="resolved">
        <span class="panel-caret">${followupsResolvedOpen?'▾':'▸'}</span>
        <span class="panel-title">Resolved</span>
        <span class="panel-meta">${resolved.length}</span>
      </button>
      ${followupsResolvedOpen?`<div class="panel-body"><div class="fu-list">
        ${resolved.map(f=>`
          <div class="fu-row done">
            <span class="fu-dot">✓</span>
            <div class="fu-main">
              <span class="fu-txt-static">${esc(f.txt)}</span>
              ${f.note?`<span class="fu-note-static">${esc(f.note)}</span>`:''}
            </div>
            <span class="fu-act reopen" data-fureopen="${f.id}" title="Reopen">↩</span>
            <span class="x" data-fudel="${f.id}">×</span>
          </div>`).join('')}
      </div></div>`:''}
    </div>`:''}
  </div>
  `;
}

function bindFollowups(){
  const ni=q('#newFollowup'); if(ni) ni.oninput=()=>{ newFollowupText=ni.value; };
  const add=q('#addFollowup'); if(add) add.onclick=addFollowup;
  if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') addFollowup(); };

  // inline edit text / note (save without re-render so typing doesn't jump)
  q('[data-futxt]','all').forEach(el=>el.oninput=()=>{ const f=(S.followups||[]).find(x=>x.id===el.dataset.futxt); if(f){ f.txt=el.value; save(); } });
  q('[data-funote]','all').forEach(el=>el.oninput=()=>{ const f=(S.followups||[]).find(x=>x.id===el.dataset.funote); if(f){ f.note=el.value; save(); } });

  // touched today — bump lastTouched without resolving
  q('[data-futouch]','all').forEach(el=>el.onclick=()=>{ const f=(S.followups||[]).find(x=>x.id===el.dataset.futouch); if(f){ f.lastTouched=Date.now(); save(false); toast('Marked touched'); rerender(); } });
  // resolve / reopen / delete
  q('[data-furesolve]','all').forEach(el=>el.onclick=()=>{ const f=(S.followups||[]).find(x=>x.id===el.dataset.furesolve); if(f){ f.resolved=true; f.lastTouched=Date.now(); save(); toast('Resolved ✓'); rerender(); } });
  q('[data-fureopen]','all').forEach(el=>el.onclick=()=>{ const f=(S.followups||[]).find(x=>x.id===el.dataset.fureopen); if(f){ f.resolved=false; f.lastTouched=Date.now(); save(); rerender(); } });
  q('[data-fudel]','all').forEach(el=>el.onclick=()=>{ S.followups=(S.followups||[]).filter(x=>x.id!==el.dataset.fudel); save(); rerender(); });
  // resolved section toggle
  q('[data-fupanel]','all').forEach(el=>el.onclick=()=>{ followupsResolvedOpen=!followupsResolvedOpen; rerender(); });
}

function addFollowup(){
  const v=(newFollowupText||'').trim(); if(!v) return;
  const now=Date.now();
  if(!S.followups) S.followups=[];
  S.followups.push({ id:b(), txt:v, note:'', createdAt:now, lastTouched:now, resolved:false });
  newFollowupText=''; save(); rerender();
}
