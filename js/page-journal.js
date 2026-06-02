/* ============================================================
   JOURNAL — reflection. Daily logging that tracks over time:
   mood, feelings, sleep, medication/supplements, daily fulfillment.
   Stored on the day record (syncs to Firestore). A hidden insights
   view (reusing renderInsights) opens from within the page.
   ============================================================ */
let journalInsightsOpen=false;

function renderJournal(){
  const d=day();
  return `
  <div class="phead compact">
    <div class="kicker">${prettyDate()}</div>
    <h2>Journal</h2>
    <p>How today actually felt. The more you log, the sharper the patterns get.</p>
  </div>

  <div class="card">
    <div class="card-h"><h3>Today's entry</h3><span class="sub">saved automatically</span></div>

    <div class="grid2">
      <div class="field" style="margin-bottom:0"><label>Mood <span class="hint">a word or two</span></label>
        <input type="text" data-jrnl="mood" value="${esc(d.mood||'')}" placeholder="e.g. focused, frazzled, calm"></div>
      <div class="field" style="margin-bottom:0"><label>Energy</label>
        <div class="energy-pills" id="jEnergy">
          ${['Low','Medium','High'].map(v=>`<button data-jenergy="${v}" class="${d.energy===v?'sel':''}">${v}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="field" style="margin-bottom:0"><label>Sleep last night</label>
        <input type="text" data-jrnl="sleep" value="${esc(d.sleep||'')}" placeholder="e.g. 7h, solid"></div>
      <div class="field" style="margin-bottom:0"><label>Medication / supplements</label>
        <input type="text" data-jrnl="meds" value="${esc(d.meds||'')}" placeholder="what you took today"></div>
    </div>

    <div class="field" style="margin-top:14px"><label>Daily fulfillment <span class="hint">how fulfilling was today? 1–10</span></label>
      <div class="fulfill-pills" id="jFulfill">
        ${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button data-jfulfill="${n}" class="${String(d.fulfillment)===String(n)?'sel':''}">${n}</button>`).join('')}
      </div>
    </div>

    <div class="field" style="margin-top:14px;margin-bottom:0"><label>Feelings / extra thoughts</label>
      <textarea data-jrnl="feelings" placeholder="Anything on your mind…">${esc(d.feelings||'')}</textarea></div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Recent entries</h3><span class="sub">last 7 days</span></div>
    <div class="jrnl-history">${renderJournalHistory()}</div>
  </div>

  <button class="btn ghost" id="jInsightsToggle" style="width:100%">${journalInsightsOpen?'▾ Hide insights & patterns':'▸ Show insights & patterns'}</button>
  ${journalInsightsOpen?`<div class="jrnl-insights">${renderInsights()}</div>`:''}
  `;
}

function renderJournalHistory(){
  const keys=Object.keys(S.days||{}).sort().reverse().slice(0,7);
  if(!keys.length) return '<div class="empty sm">No entries yet — today is day one.</div>';
  return keys.map(k=>{
    const e=S.days[k];
    const bits=[ e.energy?esc(e.energy):'—', e.sleep?esc(e.sleep):'—' ];
    if(e.fulfillment) bits.push('fulfil '+esc(String(e.fulfillment)));
    return `<div class="jrnl-row">
      <span class="jr-date">${k===todayKey()?'Today':shortDate(k)}</span>
      <span class="jr-mood">${esc(e.mood||'—')}</span>
      <span class="jr-meta">${bits.join(' · ')}</span>
    </div>`;
  }).join('');
}

function bindJournal(){
  // free-text / text fields → write straight to the day record (no re-render = no focus jump)
  q('[data-jrnl]','all').forEach(el=>el.oninput=()=>{ day()[el.dataset.jrnl]=el.value; save(); });
  // energy pills (also feeds Insights' energy series)
  q('[data-jenergy]','all').forEach(el=>el.onclick=()=>{ day().energy=el.dataset.jenergy; save(false); rerender(); });
  // fulfillment 1–10
  q('[data-jfulfill]','all').forEach(el=>el.onclick=()=>{ const d=day(); const n=+el.dataset.jfulfill; d.fulfillment=(String(d.fulfillment)===String(n))?'':n; save(false); rerender(); });
  // hidden insights view (reuses renderInsights + bindInsights)
  const it=q('#jInsightsToggle'); if(it) it.onclick=()=>{ journalInsightsOpen=!journalInsightsOpen; rerender(); };
  if(journalInsightsOpen && typeof bindInsights==='function') bindInsights();
}
