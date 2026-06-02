/* ---------- PRIORITY BOARD ---------- */
const BOARD_COLS=[
  ['mustwin','Must Win','var(--accent)','Current top priorities'],
  ['scheduled','Scheduled Decisions','var(--blue)','Needs a decision or block — not your whole day'],
  ['parking','Parking Lot','var(--txt-faint)','Matters, just not now'],
];
function renderBoard(){
  return `
  <div class="phead">
    <div class="kicker">What matters before the world tells you what's urgent</div>
    <h2>Priority Board</h2>
  </div>
  <div class="season-banner">
    <div class="lab">◐ Current Season</div>
    <input type="text" id="seasonInput" value="${esc(S.season)}">
  </div>
  <div class="board">
    ${BOARD_COLS.slice(0,2).map(c=>boardCol(c)).join('')}
  </div>
  <div style="margin-top:18px">${boardCol(BOARD_COLS[2])}</div>
  <p class="list-note">Move items between columns with the → button. The Parking Lot is not a graveyard — it's a promise to your brain that nothing is being ignored, just sequenced.</p>
  `;
}
function boardCol([key,title,color,desc]){
  const items=S.board[key]||[];
  const nextLabel={mustwin:'→ Scheduled',scheduled:'→ Parking',parking:'→ Must Win'};
  return `
  <div class="col">
    <div class="col-h">
      <div class="swatch" style="background:${color}"></div>
      <h3>${title}</h3>
      <div class="desc">${desc}</div>
    </div>
    <div class="items">
      ${items.length?items.map(it=>`
        <div class="item">
          <span class="txt">${esc(it.txt)}</span>
          <span class="move" data-move="${key}|${it.id}" title="${nextLabel[key]}">${nextLabel[key]}</span>
          <span class="x" data-bdel="${key}|${it.id}">×</span>
        </div>`).join(''):'<div class="empty" style="padding:14px">Empty</div>'}
    </div>
    <div class="additem">
      <input type="text" data-badd="${key}" placeholder="Add to ${title}...">
      <button class="btn sm" data-baddbtn="${key}">+</button>
    </div>
  </div>`;
}
function bindBoard(){
  const si=q('#seasonInput'); if(si) si.oninput=()=>{ S.season=si.value; save(); };
  q('[data-baddbtn]','all').forEach(el=>el.onclick=()=>addBoardItem(el.dataset.baddbtn));
  q('[data-badd]','all').forEach(el=>el.onkeydown=e=>{ if(e.key==='Enter') addBoardItem(el.dataset.badd); });
  q('[data-bdel]','all').forEach(el=>el.onclick=()=>{
    const [k,id]=el.dataset.bdel.split('|'); S.board[k]=S.board[k].filter(i=>i.id!==id); save(); rerender();
  });
  q('[data-move]','all').forEach(el=>el.onclick=()=>{
    const [k,id]=el.dataset.move.split('|');
    const order=['mustwin','scheduled','parking'];
    const next=order[(order.indexOf(k)+1)%3];
    const idx=S.board[k].findIndex(i=>i.id===id);
    if(idx>-1){ const [it]=S.board[k].splice(idx,1); S.board[next].push(it); save(); rerender(); }
  });
}
function addBoardItem(key){
  const i=q(`[data-badd="${key}"]`); const v=i.value.trim(); if(!v)return;
  S.board[key].push({id:b(),txt:v}); save(); rerender();
}

/* ---------- PARKING LOT (focused view) ---------- */
function renderParking(){
  const items=S.board.parking||[];
  return `
  <div class="phead">
    <div class="kicker">Not ignored. Just not now.</div>
    <h2>Parking Lot</h2>
    <p class="serif">"This is not being ignored. It is just not now."</p>
  </div>
  <div class="card">
    <div class="card-h"><h3>Parked Ideas & Wants</h3><span class="sub">${items.length} item${items.length===1?'':'s'}</span></div>
    <div class="items">
      ${items.length?items.map(it=>`
        <div class="item">
          <span class="txt">${esc(it.txt)}</span>
          <span class="move" data-pmove="${it.id}" title="Activate → Must Win">↑ Activate</span>
          <span class="x" data-pdel="${it.id}">×</span>
        </div>`).join(''):'<div class="empty">Nothing parked. Park anything pulling at your attention that is not for this season.</div>'}
    </div>
    <div class="additem">
      <input type="text" id="parkAdd" placeholder="Park something tugging at your attention...">
      <button class="btn" id="parkAddBtn">Park it</button>
    </div>
  </div>
  <p class="list-note">When the season changes, pull items up into Must Win with "Activate". Until then, they're safely held here so they stop renting space in your head.</p>
  `;
}
function bindParking(){
  const add=q('#parkAddBtn'); if(add) add.onclick=()=>{
    const i=q('#parkAdd'); const v=i.value.trim(); if(!v)return;
    S.board.parking.push({id:b(),txt:v}); save(); rerender();
  };
  const pi=q('#parkAdd'); if(pi) pi.onkeydown=e=>{ if(e.key==='Enter') q('#parkAddBtn').click(); };
  q('[data-pdel]','all').forEach(el=>el.onclick=()=>{
    S.board.parking=S.board.parking.filter(i=>i.id!==el.dataset.pdel); save(); rerender();
  });
  q('[data-pmove]','all').forEach(el=>el.onclick=()=>{
    const id=el.dataset.pmove; const idx=S.board.parking.findIndex(i=>i.id===id);
    if(idx>-1){ const [it]=S.board.parking.splice(idx,1); S.board.mustwin.push(it); save(); toast('Activated → Must Win'); rerender(); }
  });
}

/* ---------- RULES / FUTURE SELF ---------- */
let editRules=false;
function renderRules(){
  return `
  <div class="phead">
    <div class="kicker">Marco Rules · operating principles</div>
    <h2>Rules / Future Self</h2>
    <p>The non-negotiables. Read them when you're drifting. <span class="serif">"MarcoMaster tells Marco what matters before the world tells Marco what is urgent."</span></p>
  </div>
  <div class="btn-row" style="margin-bottom:18px">
    <button class="btn ghost sm" id="toggleEditRules">${editRules?'✓ Done editing':'✎ Edit rules'}</button>
  </div>
  ${editRules?`
    <div class="card">
      ${S.rules.map((r,i)=>`
        <div class="focusrow">
          <span class="tag" style="color:var(--accent)">#${i+1}</span>
          <input type="text" data-rule="${i}" value="${esc(r)}">
          <span class="x" style="cursor:pointer;color:var(--txt-faint);font-size:18px;padding:0 6px" data-ruledel="${i}">×</span>
        </div>`).join('')}
      <div class="additem" style="margin-top:14px">
        <input type="text" id="newRule" placeholder="Add a rule / standard...">
        <button class="btn" id="addRule">Add</button>
      </div>
    </div>`
  :
    S.rules.map((r,i)=>`<div class="rule"><span class="num">${String(i+1).padStart(2,'0')}</span><div class="body">${esc(r)}</div></div>`).join('')
  }
  <div class="card" style="margin-top:24px">
    <div class="card-h"><h3>Future Self Narrative</h3><span class="sub">who you're becoming</span></div>
    <textarea data-narrative style="min-height:160px" placeholder="Write, in present tense, who you are becoming. The version of Marco who has the systems, the health, the business, the freedom. Re-read and update quarterly.">${esc(S.narrative||'')}</textarea>
  </div>
  `;
}
function bindRules(){
  const t=q('#toggleEditRules'); if(t) t.onclick=()=>{ editRules=!editRules; rerender(); };
  q('[data-rule]','all').forEach(el=>el.oninput=()=>{ S.rules[+el.dataset.rule]=el.value; save(); });
  q('[data-ruledel]','all').forEach(el=>el.onclick=()=>{ S.rules.splice(+el.dataset.ruledel,1); save(); rerender(); });
  const ar=q('#addRule'); if(ar) ar.onclick=()=>{
    const i=q('#newRule'); const v=i.value.trim(); if(!v)return; S.rules.push(v); save(); rerender();
  };
  const ni=q('#newRule'); if(ni) ni.onkeydown=e=>{ if(e.key==='Enter') q('#addRule').click(); };
  const na=q('[data-narrative]'); if(na) na.oninput=()=>{ S.narrative=na.value; save(); };
}

