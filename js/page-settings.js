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
