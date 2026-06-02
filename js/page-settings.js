/* ============================================================
   SETTINGS — edit reset checklist, day window, data controls
   ============================================================ */
function renderSettings(){
  const st=S.settings;
  return `
  <div class="phead">
    <div class="kicker">Make it yours</div>
    <h2>Settings</h2>
    <p>Tune MarcoMaster so it fits how you actually work. Keep it simple — only change what's getting in your way.</p>
  </div>

  <div class="card">
    <div class="card-h"><h3>Daily Reset Checklist</h3><span class="sub">${st.resetSteps.length} steps</span></div>
    <p class="inbox-rule" style="margin-top:0">These are the steps you run each morning on Today. Edit the wording, reorder, add or remove. Fewer is more for an ADHD morning.</p>
    <div class="set-steps">
      ${st.resetSteps.map((s,i)=>`
        <div class="set-step">
          <span class="step-num">${i+1}</span>
          <input type="text" data-setstep="${i}" value="${esc(s.label)}">
          <span class="step-move" data-stepup="${i}" title="move up">▲</span>
          <span class="step-move" data-stepdown="${i}" title="move down">▼</span>
          <span class="x" data-stepdel="${i}">×</span>
        </div>`).join('')}
    </div>
    <div class="additem" style="margin-top:12px">
      <input type="text" id="newStep" placeholder="Add a reset step...">
      <button class="btn" id="addStep">Add</button>
    </div>
    <button class="btn ghost sm" id="resetStepsDefault" style="margin-top:12px">↺ Restore default checklist</button>
  </div>

  <div class="card">
    <div class="card-h"><h3>Day Window</h3><span class="sub">Plan grid hours</span></div>
    <p class="inbox-rule" style="margin-top:0">The hours shown on your Plan time-block grid.</p>
    <div class="set-row">
      <label>Start of day</label>
      <select id="setDayStart">${settingsHourOpts(st.dayStart,5,12)}</select>
      <label>End of day</label>
      <select id="setDayEnd">${settingsHourOpts(st.dayEnd,15,23)}</select>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Pages</h3></div>
    <div class="set-toggle">
      <div>
        <div class="st-title">Show "More" pages</div>
        <div class="st-desc">MarcoMaster stays stripped to the daily essentials — Today, Time Blocker, Night. Turn this on to reveal the life-OS pages (Scorecard, Priority Board, Parking Lot, Rules, Insights, Weekly Review, Recurring) in the sidebar under "More". Your data in them is always kept either way.</div>
      </div>
      <button class="switch ${st.showMore?'on':''}" id="setShowMore"><span class="knob"></span></button>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Recurring Tasks</h3></div>
    <div class="set-toggle">
      <div>
        <div class="st-title">Auto-add due recurring tasks to your day</div>
        <div class="st-desc">When on, recurring tasks appear in your Today list automatically when due. Off means they only live on the Recurring page.</div>
      </div>
      <button class="switch ${st.autoAddRecurring!==false?'on':''}" id="setAutoAdd"><span class="knob"></span></button>
    </div>
    <button class="btn ghost sm" id="goRecurring" style="margin-top:14px">→ Manage recurring tasks & schedules</button>
  </div>

  <div class="card">
    <div class="card-h"><h3>Data</h3></div>
    <p class="inbox-rule" style="margin-top:0">Everything saves automatically${FB.user?' and syncs to your account across devices':' on this device'}. Use these only if you need to.</p>
    <div class="btn-row">
      <button class="btn ghost sm" id="exportData">⬇ Export my data (JSON)</button>
      <button class="btn ghost sm" id="wipeToday">Clear today's tasks</button>
      <button class="btn ghost sm danger" id="wipeAll">⚠ Wipe everything</button>
    </div>
    <p class="list-note" style="margin-top:14px">Export gives you a backup file you can keep. Wipe everything resets MarcoMaster to factory defaults — there's a confirmation step.</p>
  </div>

  ${FB.user?`
  <div class="card">
    <div class="card-h"><h3>Account</h3></div>
    <div class="set-toggle">
      <div>
        <div class="st-title">Signed in${FB.user.email?' as '+esc(FB.user.email):''}</div>
        <div class="st-desc">Your data syncs to this account. Sign in on any device to pick up where you left off.</div>
      </div>
      <button class="btn ghost sm" id="signOutBtn">Sign out</button>
    </div>
  </div>`:''}
  `;
}
function settingsHourOpts(sel,from,to){
  let o=''; for(let h=from;h<=to;h++) o+=`<option value="${h}" ${h===sel?'selected':''}>${fmtHour(h)}</option>`; return o;
}
function bindSettings(){
  // reset steps
  q('[data-setstep]','all').forEach(el=>el.oninput=()=>{ S.settings.resetSteps[+el.dataset.setstep].label=el.value; save(); });
  q('[data-stepdel]','all').forEach(el=>el.onclick=()=>{ S.settings.resetSteps.splice(+el.dataset.stepdel,1); save(); rerender(); });
  q('[data-stepup]','all').forEach(el=>el.onclick=()=>{ const i=+el.dataset.stepup; if(i>0){ const a=S.settings.resetSteps; [a[i-1],a[i]]=[a[i],a[i-1]]; save(); rerender(); } });
  q('[data-stepdown]','all').forEach(el=>el.onclick=()=>{ const i=+el.dataset.stepdown; const a=S.settings.resetSteps; if(i<a.length-1){ [a[i+1],a[i]]=[a[i],a[i+1]]; save(); rerender(); } });
  const addStep=q('#addStep'); if(addStep) addStep.onclick=()=>{
    const i=q('#newStep'); const v=i.value.trim(); if(!v)return;
    S.settings.resetSteps.push({id:b(),label:v}); save(); rerender();
  };
  const ns=q('#newStep'); if(ns) ns.onkeydown=e=>{ if(e.key==='Enter') q('#addStep').click(); };
  const rsd=q('#resetStepsDefault'); if(rsd) rsd.onclick=()=>{
    if(confirm('Restore the default Daily Reset checklist? Your current steps will be replaced.')){
      S.settings.resetSteps=DEFAULT_RESET_STEPS.map(s=>({id:s[0],label:s[1]})); save(); rerender();
    }
  };
  // day window
  const ds=q('#setDayStart'); if(ds) ds.onchange=()=>{ S.settings.dayStart=+ds.value; save(); };
  const de=q('#setDayEnd'); if(de) de.onchange=()=>{ S.settings.dayEnd=+de.value; save(); };
  // auto-add toggle
  const aa=q('#setAutoAdd'); if(aa) aa.onclick=()=>{ S.settings.autoAddRecurring=!(S.settings.autoAddRecurring!==false); save(); rerender(); };
  const sm=q('#setShowMore'); if(sm) sm.onclick=()=>{ S.settings.showMore=!S.settings.showMore; save(false); renderNav(); rerender(); };
  const gr=q('#goRecurring'); if(gr) gr.onclick=()=>{ S.settings.showMore=true; save(false); go('recurring'); };
  // data
  const ex=q('#exportData'); if(ex) ex.onclick=()=>{
    const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download='marcomaster-backup-'+todayKey()+'.json'; a.click(); URL.revokeObjectURL(url);
    toast('Exported ✓');
  };
  const wt=q('#wipeToday'); if(wt) wt.onclick=()=>{
    if(confirm("Clear today's tasks? This removes all tasks in your Today list (completed and active).")){
      day().tasks=[]; day().archive=[]; day().recurringAdded={}; save(); toast('Today cleared'); go('today');
    }
  };
  const wa=q('#wipeAll'); if(wa) wa.onclick=()=>{
    if(confirm('Wipe EVERYTHING and reset to defaults? This cannot be undone. Consider exporting first.')){
      if(confirm('Are you absolutely sure? All your history, tasks, scores and journals will be gone.')){
        S={}; persist().then(()=>location.reload());
      }
    }
  };
  const so=q('#signOutBtn'); if(so) so.onclick=()=>{ if(typeof signOut==='function') signOut(); };
}
