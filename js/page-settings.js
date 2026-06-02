/* ============================================================
   SETTINGS — third tab. Project management (add/edit/delete +
   names/colors, reusing the Projects render), recurring tasks
   (reusing the Recurring render), and preferences/data controls.
   ============================================================ */
function renderSettings(){
  const st=S.settings||{};
  return `
  <div class="phead compact">
    <div class="kicker">Make it yours</div>
    <h2>Settings</h2>
  </div>

  <div class="set-section">
    ${renderProjects()}
  </div>

  <div class="set-section">
    ${renderRecurring()}
  </div>

  <div class="card">
    <div class="card-h"><h3>Preferences</h3></div>
    <div class="set-row">
      <label>Theme</label>
      <button class="btn ghost sm" id="setTheme">${(S.theme==='light')?'◑ Switch to dark':'◐ Switch to light'}</button>
    </div>
    <div class="set-row" style="margin-top:12px">
      <label>Day start</label>
      <select id="setDayStart">${settingsHourOpts(st.dayStart||8,5,12)}</select>
      <label>Day end</label>
      <select id="setDayEnd">${settingsHourOpts(st.dayEnd||21,15,23)}</select>
    </div>
    <div class="set-toggle" style="margin-top:14px">
      <div>
        <div class="st-title">Auto-add due recurring tasks</div>
        <div class="st-desc">When on, recurring tasks appear in your Dashboard lists automatically when due.</div>
      </div>
      <button class="switch ${st.autoAddRecurring!==false?'on':''}" id="setAutoAdd"><span class="knob"></span></button>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Data</h3></div>
    <p class="inbox-rule" style="margin-top:0">Everything saves automatically${FB.user?' and syncs to your account across devices':' on this device'}.</p>
    <div class="btn-row">
      <button class="btn ghost sm" id="exportData">⬇ Export my data (JSON)</button>
      <button class="btn ghost sm" id="wipeToday">Clear today's tasks</button>
      <button class="btn ghost sm danger" id="wipeAll">⚠ Wipe everything</button>
    </div>
    <p class="list-note" style="margin-top:14px">Export gives you a backup file. Wipe everything resets MarcoMaster to defaults — with a confirmation step.</p>
  </div>

  ${FB.user?`
  <div class="card">
    <div class="card-h"><h3>Account</h3></div>
    <div class="set-toggle">
      <div><div class="st-title">Signed in${FB.user.email?' as '+esc(FB.user.email):''}</div>
      <div class="st-desc">Your data syncs to this account across devices.</div></div>
      <button class="btn ghost sm" id="signOutBtn">Sign out</button>
    </div>
  </div>`:''}
  `;
}
function settingsHourOpts(sel,from,to){
  let o=''; for(let h=from;h<=to;h++) o+=`<option value="${h}" ${h===sel?'selected':''}>${fmtHour(h)}</option>`; return o;
}
function bindSettings(){
  bindProjects();      // add/edit/delete projects + names/colors + tasks within projects
  bindRecurring();     // recurring cadence manager

  const tb=q('#setTheme'); if(tb) tb.onclick=()=>{ toggleTheme(); rerender(); };
  const ds=q('#setDayStart'); if(ds) ds.onchange=()=>{ S.settings.dayStart=+ds.value; save(); };
  const de=q('#setDayEnd'); if(de) de.onchange=()=>{ S.settings.dayEnd=+de.value; save(); };
  const aa=q('#setAutoAdd'); if(aa) aa.onclick=()=>{ S.settings.autoAddRecurring=!(S.settings.autoAddRecurring!==false); save(); rerender(); };

  const ex=q('#exportData'); if(ex) ex.onclick=()=>{
    const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download='marcomaster-backup-'+todayKey()+'.json'; a.click(); URL.revokeObjectURL(url);
    toast('Exported ✓');
  };
  const wt=q('#wipeToday'); if(wt) wt.onclick=()=>{
    if(confirm("Clear today's tasks? This removes all tasks in your Today list (completed and active).")){
      day().tasks=[]; day().archive=[]; day().recurringAdded={}; save(); toast('Today cleared'); go('dashboard');
    }
  };
  const wa=q('#wipeAll'); if(wa) wa.onclick=()=>{
    if(confirm('Wipe EVERYTHING and reset to defaults? This cannot be undone. Consider exporting first.')){
      if(confirm('Are you absolutely sure? All your history, tasks and journals will be gone.')){
        S={}; persist().then(()=>location.reload());
      }
    }
  };
  const so=q('#signOutBtn'); if(so) so.onclick=()=>{ if(typeof signOut==='function') signOut(); };
}
