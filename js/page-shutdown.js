/* ---------- NIGHT SHUTDOWN ---------- */
function renderShutdown(){
  const d=day();
  const s=d.shutdown;
  const done=completedToday();
  const tmr=d.tomorrow.length?d.tomorrow:['','',''];
  while(tmr.length<3) tmr.push('');
  const txt=(id,lbl,ph)=>`<div class="card" style="padding:16px 20px"><div class="field" style="margin-bottom:0"><label>${lbl}</label><textarea data-sd="${id}" placeholder="${ph}">${esc(s[id]||'')}</textarea></div></div>`;
  const chk=(id,lbl)=>`<div class="check ${s[id]?'done':''}" data-sdcheck="${id}"><div class="box">✓</div><div class="lbl">${lbl}</div></div>`;
  // mood/energy snapshot for the day
  const ci=d.checkins;
  const avgE=ci.length?(ci.reduce((a,c)=>a+(energyToNum(c.energy)||0),0)/ci.length):null;
  return `
  <div class="phead">
    <div class="kicker">Close the loops · ${prettyDate()}</div>
    <h2>Night Shutdown</h2>
    <p>Empty the head before bed so racing thoughts don't keep you up.</p>
  </div>

  <div class="card accomplish">
    <div class="card-h"><h3>✓ Today's Accomplishments</h3><span class="sub">${done.length} done</span></div>
    ${done.length?`<div class="accomplish-list">
      ${done.map(t=>`<div class="acc-item"><span class="acc-dot ${t.kind==='quick'?'q':'p'}">${t.kind==='quick'?'⚡':'▣'}</span><span>${esc(t.txt)}</span>${t.doneAt?`<span class="acc-time">${t.doneAt}</span>`:''}</div>`).join('')}
    </div>`:'<div class="empty">Nothing marked complete yet today. Check things off on Today / Plan and they show up here.</div>'}
    <div class="acc-snapshot">
      <div class="snap"><span class="lab">Check-ins</span><span class="v">${ci.length}</span></div>
      <div class="snap"><span class="lab">Avg energy</span><span class="v">${avgE!=null?avgE.toFixed(1)+'/3':'—'}</span></div>
      <div class="snap"><span class="lab">Morning mood</span><span class="v">${esc(d.mood||'—')}</span></div>
      <div class="snap"><span class="lab">Sleep</span><span class="v">${esc(d.sleep||'—')}</span></div>
    </div>
  </div>

  ${txt('well','What went well today?','...')}
  ${txt('drift','Where did I drift?','...')}
  ${txt('avoid','What did I avoid?','...')}
  <div class="card">
    <div class="card-h"><h3>The Three Checks</h3></div>
    ${chk('trained','Did I train / move?')}
    ${chk('health','Did I protect my health?')}
    ${chk('time','Did I respect my time?')}
  </div>

  <div class="card" style="border-left:3px solid var(--accent)">
    <div class="card-h"><h3>Top 3 For Tomorrow</h3><span class="sub">seeds into tomorrow's tasks</span></div>
    ${[0,1,2].map(i=>`
      <div class="focusrow">
        <span class="tag" style="color:var(--accent)">#${i+1}</span>
        <input type="text" data-tmr="${i}" value="${esc(tmr[i]||'')}" placeholder="${i===0?'The most important thing':'Next priority'}">
      </div>`).join('')}
    <div class="field" style="margin:14px 0 0"><label style="color:var(--accent)">Tomorrow's first move</label>
      <input type="text" data-sd="firstMove" value="${esc(s.firstMove||'')}" placeholder="The one action you start with — before reacting"></div>
    <div class="field" style="margin-bottom:0;margin-top:14px"><label>Out of my head before bed</label>
      <textarea data-sd="clear" placeholder="Dump anything still looping. Park it. Let it go.">${esc(s.clear||'')}</textarea></div>
  </div>
  <p class="list-note">Your top 3 are dropped into tomorrow's Task Inbox as projects (flagged "from yesterday"), and your first move shows at the top of Today. You wake into a plan, not a blank page.</p>
  `;
}
function bindShutdown(){
  q('[data-sd]','all').forEach(el=>el.oninput=()=>{ day().shutdown[el.dataset.sd]=el.value; save(); });
  q('[data-sdcheck]','all').forEach(el=>el.onclick=()=>{
    const id=el.dataset.sdcheck; const s=day().shutdown; s[id]=!s[id]; save(false); rerender();
  });
  q('[data-tmr]','all').forEach(el=>el.oninput=()=>{
    const i=+el.dataset.tmr; const d=day();
    while(d.tomorrow.length<3) d.tomorrow.push('');
    d.tomorrow[i]=el.value; save();
  });
}
