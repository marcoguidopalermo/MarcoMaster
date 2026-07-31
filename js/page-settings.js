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
    <div class="card-h"><h3>Future Self Narrative</h3><span class="sub">read it every morning</span></div>
    <p class="list-note" style="margin-top:0">Plain text. Line breaks and paragraphs are preserved in the reader (Future Self tab). Saves automatically.</p>
    <div class="set-fsn">
      <label class="fsn-lbl">Full</label>
      <textarea data-fsn="full" style="min-height:200px" placeholder="Write, in present tense, who you are becoming — the version of Marco who has the systems, the health, the business, the freedom. The full narrative you re-read to remember where you're going.">${esc((S.narrative&&S.narrative.full)||'')}</textarea>
      <label class="fsn-lbl">Condensed</label>
      <textarea data-fsn="condensed" style="min-height:120px" placeholder="A shorter version for days you only have a minute — the essence of the full narrative.">${esc((S.narrative&&S.narrative.condensed)||'')}</textarea>
      <label class="fsn-lbl">Principles</label>
      <textarea data-fsn="principles" style="min-height:120px" placeholder="The core principles / standards you live by — one per line.">${esc((S.narrative&&S.narrative.principles)||'')}</textarea>
    </div>
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

  ${renderPushCard()}

  <div class="card" id="dataProtection">
    <div class="card-h"><h3>🛡️ Data protection</h3></div>
    <p class="inbox-rule" style="margin-top:0">Everything saves automatically${FB.user?' and syncs to your account across devices':' on this device'}. A safety guard blocks any save that would erase most of your data, and rolling local backups are kept automatically.</p>
    <div class="btn-row">
      <button class="btn ghost sm" id="exportData">⬇ Export / Backup (JSON)</button>
      <button class="btn ghost sm" id="importData">⬆ Import / Restore from file</button>
      <button class="btn ghost sm" id="wipeToday">Clear today's tasks</button>
      <button class="btn ghost sm danger" id="wipeAll">⚠ Wipe everything</button>
    </div>

    <div class="ab-section">
      <div class="card-h" style="margin-top:18px"><h3 style="font-size:11px">Automatic backups</h3><span class="sub">last ${AB_SLOTS} snapshots</span></div>
      ${renderAutoBackups()}
      <p class="list-note" style="margin-top:10px">These are saved locally on this device as you work. Restoring <b>replaces</b> your current data (a fresh backup is taken first). Wipe everything is the only way to intentionally clear data — it bypasses the safety guard with a double confirmation.</p>
    </div>
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
/* Notifications card — reflects pushSupport() state. Tap-gated enable only; no
   nagging prompts. The button (state 'supported') is the sole path that prompts. */
function renderPushCard(){
  const state = (typeof pushSupport==='function') ? pushSupport() : 'unsupported';
  let body;
  if(state==='granted'){
    body = `<div class="push-state"><span class="push-dot on"></span><div><div class="st-title">Notifications enabled</div>
      <div class="st-desc">This device will receive reminders. You can turn them off in your browser or device settings.</div></div></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn ghost sm" id="testPushBtn">Send test notification</button></div>`;
  }else if(state==='supported'){
    body = `<div class="set-toggle">
        <div><div class="st-title">Get reminders on this device</div>
        <div class="st-desc">A single tap asks your browser for permission. Nothing is sent yet — this just registers the device.</div></div>
        <button class="btn ghost sm" id="enablePushBtn">Enable notifications</button>
      </div>`;
  }else if(state==='denied'){
    body = `<div class="push-state"><span class="push-dot off"></span><div><div class="st-title">Notifications are blocked</div>
      <div class="st-desc">Turn them back on for this site in your browser or device settings, then reload.</div></div></div>`;
  }else if(state==='ios-not-installed'){
    body = `<div class="push-state"><span class="push-dot off"></span><div><div class="st-title">Add to Home Screen first</div>
      <div class="st-desc">On iPhone/iPad, notifications only work when MarcoMaster runs as an installed app:</div>
      <ol class="push-steps">
        <li>Tap the <b>Share</b> button in Safari (the square with an up-arrow).</li>
        <li>Choose <b>Add to Home Screen</b>.</li>
        <li>Open MarcoMaster from the new Home Screen icon, then come back here to enable notifications.</li>
      </ol></div></div>`;
  }else{
    body = `<div class="push-state"><span class="push-dot off"></span><div><div class="st-title">Not supported here</div>
      <div class="st-desc">This browser doesn't support push notifications.</div></div></div>`;
  }
  return `
  <div class="card" id="pushCard">
    <div class="card-h"><h3>🔔 Notifications</h3></div>
    ${body}
    ${renderNotifConfig(state)}
  </div>`;
}
/* Read/write a dotted path within S.notifSettings (e.g. "appt.digest.enabled"). */
function getNotif(path){
  return path.split('.').reduce((o,k)=> (o==null?undefined:o[k]), S.notifSettings);
}
function setNotif(path, val){
  if(!S.notifSettings || typeof S.notifSettings!=='object') S.notifSettings={};
  const keys=path.split('.'); let o=S.notifSettings;
  for(let i=0;i<keys.length-1;i++){ if(!o[keys[i]] || typeof o[keys[i]]!=='object') o[keys[i]]={}; o=o[keys[i]]; }
  o[keys[keys.length-1]]=val;
}
/* Time-of-day options at 15-min increments (:00/:15/:30/:45 — all exact scheduler
   ticks) from fromHour:00 to toHour:00 inclusive. Value = minutes since midnight. */
function settingsTimeOpts(selMin, fromHour, toHour){
  let o='';
  for(let m=fromHour*60; m<=toHour*60; m+=15){
    const lbl=fmtClock(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
    o+=`<option value="${m}" ${m===selMin?'selected':''}>${lbl}</option>`;
  }
  return o;
}
/* Options for the "minutes before" and check-in "interval" selects. */
function notifMinsOpts(sel, pairs){
  return pairs.map(([v,lbl])=>`<option value="${v}" ${v===sel?'selected':''}>${lbl}</option>`).join('');
}
/* Account-level push behaviour — selects + toggles, autosaved. Times are
   whole-hour selects: the scheduler ticks every 15 min, so honest resolution.
   Rendered in every permission state (it drives the server for all devices). */
function renderNotifConfig(state){
  const ns=S.notifSettings||{};
  const appt=ns.appt||{}, digest=appt.digest||{}, checkin=ns.checkin||{};
  const sw=(on,path)=>`<button class="switch ${on?'on':''}" data-notif="${path}"><span class="knob"></span></button>`;
  const LEAD=[[15,'15 min'],[30,'30 min'],[60,'1 hour'],[120,'2 hours']];
  const LEAD2=[[0,'Off'],[15,'15 min'],[30,'30 min'],[60,'1 hour'],[120,'2 hours']];
  const INTERVAL=[[30,'30 min'],[60,'1 hour'],[90,'90 min'],[120,'2 hours']];
  const notThisDevice = (state!=='granted')
    ? `<p class="list-note" style="margin-top:0">These apply to all your devices. Enable notifications on <b>this</b> device above to receive them here.</p>` : '';
  return `
  <div class="notif-config">
    ${notThisDevice}
    <div class="set-toggle">
      <div><div class="st-title">All push notifications</div>
      <div class="st-desc">Master switch — off pauses everything below.</div></div>
      ${sw(ns.master, 'master')}
    </div>
    ${ns.master ? `
    <div class="notif-sub">
      <div class="set-toggle">
        <div><div class="st-title">Appointment reminders</div>
        <div class="st-desc">A heads-up before each appointment.</div></div>
        ${sw(appt.enabled, 'appt.enabled')}
      </div>
      ${appt.enabled ? `
        <div class="set-row"><label>Remind me</label>
          <select data-notif="appt.minutesBefore">${notifMinsOpts(appt.minutesBefore, LEAD)}</select>
          <label>before</label></div>
        <div class="set-row"><label>Also remind</label>
          <select data-notif="appt.minutesBefore2">${notifMinsOpts(appt.minutesBefore2||0, LEAD2)}</select>
          <label>before</label></div>
        <div class="set-toggle">
          <div><div class="st-title">Daily digest</div>
          <div class="st-desc">One morning push listing today's appointments.</div></div>
          ${sw(digest.enabled, 'appt.digest.enabled')}
        </div>
        ${digest.enabled ? `<div class="set-row"><label>Digest time</label>
          <select data-notif="appt.digest.atMin">${settingsTimeOpts(digest.atMin,5,12)}</select></div>` : ''}
      ` : ''}
    </div>
    <div class="notif-sub">
      <div class="set-toggle">
        <div><div class="st-title">Check-in reminders</div>
        <div class="st-desc">Periodic nudges to log how you're doing.</div></div>
        ${sw(checkin.enabled, 'checkin.enabled')}
      </div>
      ${checkin.enabled ? `
        <div class="set-row"><label>Every</label>
          <select data-notif="checkin.intervalMin">${notifMinsOpts(checkin.intervalMin, INTERVAL)}</select></div>
        <div class="set-row"><label>Between</label>
          <select data-notif="checkin.startMin">${settingsTimeOpts(checkin.startMin,5,22)}</select>
          <label>and</label>
          <select data-notif="checkin.endMin">${settingsTimeOpts(checkin.endMin,6,23)}</select></div>
      ` : ''}
    </div>
    <div class="notif-sub">
      <div class="set-toggle">
        <div><div class="st-title">Night reminder</div>
        <div class="st-desc">Evening journal nudge, a preview of tomorrow's appointments, and a bedtime prompt.</div></div>
        ${sw((ns.night||{}).enabled, 'night.enabled')}
      </div>
      ${(ns.night||{}).enabled ? `<div class="set-row"><label>At</label>
        <select data-notif="night.atMin">${settingsTimeOpts((ns.night||{}).atMin==null?21*60:ns.night.atMin,17,23)}</select></div>` : ''}
    </div>
    ` : ''}
  </div>`;
}
/* the rolling local auto-backups, newest first, with timestamps + item counts */
function renderAutoBackups(){
  const list=listAutoBackups();
  if(!list.length) return '<p class="list-note" style="margin-top:8px">No automatic backups yet — they appear here as you use the app.</p>';
  return `<div class="autobackup-list">
    ${list.map(e=>{
      const s=e.summary||{};
      const when=new Date(e.ts).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      return `<div class="autobackup-row">
        <div class="ab-main">
          <span class="ab-when">${when}</span>
          <span class="ab-counts">${s.projects||0} proj · ${s.tasks||0} tasks · ${s.appointments||0} appt · ${s.followups||0} f/u · ${s.meetings||0} mtg · ${s.days||0} days</span>
        </div>
        <button class="btn ghost sm" data-abrestore="${e.slot}">Restore</button>
      </div>`;
    }).join('')}
  </div>`;
}
/* replace the current state with a restored one (file import or auto-backup). This
   is an explicit, confirmed user action, so it FORCE-writes past the shrink guard.
   A snapshot of the current state is taken first, so a restore is itself undoable. */
function restoreState(newState, label){
  if(!newState || typeof newState!=='object' || Array.isArray(newState)){ alert('That backup is unreadable.'); return; }
  const cur=backupSummary(S), nw=backupSummary(newState);
  const line=(s)=>`${s.projects} proj · ${s.tasks} tasks · ${s.appointments} appt · ${s.followups} f/u · ${s.meetings} mtg · ${s.days} days`;
  if(!confirm(`Restore ${label}?\n\nReplaces current data:\n  now:  ${line(cur)}\n  new:  ${line(nw)}\n\nA backup of your current data is taken first.`)) return;
  try{ recordAutoBackup(S); }catch(e){}
  S=newState;
  seedDefaults();
  Store._lsSet('marcomaster', S);
  Store._gateOpen=true;
  persist({force:true, bump:true}).then(synced=>{
    toast(synced?'Restored ✓ (synced)':'Restored ✓ (saved locally)');
    location.reload();
  });
}
function bindSettings(){
  bindProjects();      // add/edit/delete projects + names/colors + tasks within projects
  bindRecurring();     // recurring cadence manager

  // Future Self Narrative editors — autosave through the normal save() path, no
  // re-render (keep the caret where it is while typing).
  q('[data-fsn]','all').forEach(el=>el.oninput=()=>{ if(!S.narrative) S.narrative={full:'',condensed:'',principles:''}; S.narrative[el.dataset.fsn]=el.value; save(); });

  // Notifications: tap-gated enable (the only path that prompts). Re-render to
  // reflect the new state (enabled / blocked) after the browser resolves.
  const ep=q('#enablePushBtn'); if(ep) ep.onclick=async()=>{
    ep.disabled=true; ep.textContent='Enabling…';
    try{ await enablePush(); }catch(e){ console.warn('enablePush failed', e); }
    rerender();
  };
  // Notification settings — nested-path toggles + selects, autosaved. Toggles
  // re-render (they reveal/hide sub-controls); selects save without re-render.
  q('[data-notif]','all').forEach(el=>{
    const path=el.dataset.notif;
    if(el.tagName==='SELECT'){ el.onchange=()=>{ setNotif(path, +el.value); save(); }; }
    else { el.onclick=()=>{ setNotif(path, !getNotif(path)); save(); rerender(); }; }
  });

  // Fire a test push to this account's devices on demand (calls the callable).
  const tp=q('#testPushBtn'); if(tp) tp.onclick=async()=>{
    tp.disabled=true; const label=tp.textContent; tp.textContent='Sending…';
    try{ await sendTestPush(); }catch(e){ console.error('sendTestPush failed', e); }
    tp.disabled=false; tp.textContent=label;
  };

  const tb=q('#setTheme'); if(tb) tb.onclick=()=>{ toggleTheme(); rerender(); };
  const ds=q('#setDayStart'); if(ds) ds.onchange=()=>{ S.settings.dayStart=+ds.value; save(); };
  const de=q('#setDayEnd'); if(de) de.onchange=()=>{ S.settings.dayEnd=+de.value; save(); };
  const aa=q('#setAutoAdd'); if(aa) aa.onclick=()=>{ S.settings.autoAddRecurring=!(S.settings.autoAddRecurring!==false); save(); rerender(); };

  const ex=q('#exportData'); if(ex) ex.onclick=()=>{
    const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    const n=new Date(); const hhmm=String(n.getHours()).padStart(2,'0')+String(n.getMinutes()).padStart(2,'0');
    a.href=url; a.download='marcomaster-backup-'+todayKey()+'-'+hhmm+'.json'; a.click(); URL.revokeObjectURL(url);
    toast('Exported ✓');
  };
  // restore from an automatic local backup (explicit, confirmed → bypasses the guard)
  q('[data-abrestore]','all').forEach(el=>el.onclick=()=>{
    const st=getAutoBackupState(el.dataset.abrestore);
    if(!st){ alert('That backup could not be read.'); return; }
    restoreState(st, 'this automatic backup');
  });

  // Import / Restore — read a backup JSON and REPLACE the current state with it.
  // Uses a throwaway file input so we don't need a permanent element in the DOM.
  const im=q('#importData'); if(im) im.onclick=()=>{
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='application/json,.json';
    inp.onchange=()=>{
      const file=inp.files&&inp.files[0]; if(!file) return;
      const reader=new FileReader();
      reader.onerror=()=>alert('Could not read that file.');
      reader.onload=()=>{
        let data;
        try{ data=JSON.parse(reader.result); }
        catch(e){ alert('That file is not valid JSON — pick a MarcoMaster backup file.'); return; }
        if(!data || typeof data!=='object' || Array.isArray(data)){
          alert("That file doesn't look like a MarcoMaster backup."); return;
        }
        const summary=[
          (data.projects||[]).length+' projects',
          (data.followups||[]).length+' follow-ups',
          (data.appointments||[]).length+' appointments',
          Object.keys(data.days||{}).length+' days of history',
        ].join(' · ');
        if(!confirm('Import this backup?\n\n'+summary+'\n\nThis REPLACES your current data. Export first if you want to keep what you have now.')) return;
        // snapshot the CURRENT state first so an import is itself recoverable
        try{ recordAutoBackup(S); }catch(e){}
        S=data;
        seedDefaults();                   // backfill any missing fields + run migrations
        Store._lsSet('marcomaster', S);   // cache immediately so a reload is safe
        Store._gateOpen=true;
        persist({force:true, bump:true}).then(synced=>{   // explicit restore → bypass the shrink guard
          toast(synced?'Imported ✓ (synced)':'Imported ✓ (saved locally)');
          location.reload();              // re-render everything cleanly from the new state
        });
      };
      reader.readAsText(file);
    };
    inp.click();
  };
  const wt=q('#wipeToday'); if(wt) wt.onclick=()=>{
    if(confirm("Clear today's tasks? This removes all tasks in your Today list (completed and active).")){
      try{ recordAutoBackup(S); }catch(e){}          // recoverable even after a clear
      day().tasks=[]; day().archive=[]; day().recurringAdded={};
      Store._gateOpen=true;
      persist({force:true, bump:true});              // explicit clear → bypass the guard
      toast('Today cleared'); go('dashboard');
    }
  };
  const wa=q('#wipeAll'); if(wa) wa.onclick=()=>{
    if(confirm('Wipe EVERYTHING and reset to defaults? This cannot be undone. Consider exporting first.')){
      if(confirm('Are you absolutely sure? All your history, tasks and journals will be gone.')){
        try{ recordAutoBackup(S); }catch(e){}        // last safety net before a full wipe
        S={};
        Store._gateOpen=true;
        persist({force:true, bump:true}).then(()=>location.reload());   // intentional → bypass the guard
      }
    }
  };
  const so=q('#signOutBtn'); if(so) so.onclick=()=>{ if(typeof signOut==='function') signOut(); };
}
