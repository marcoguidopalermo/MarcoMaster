/* ---------- WEEKLY CEO REVIEW ---------- */
const REVIEW_Q = [
  ['well','What went well this week?'],
  ['drift','Where did I drift?'],
  ['cause','What caused the drift?'],
  ['avoid','What did I avoid?'],
  ['top3','Top 3 priorities next week'],
  ['park','What needs to be parked?'],
  ['delegate','What needs to be delegated?'],
  ['system','One system that needs improvement'],
];
const REVIEW_SCORES = [['health','Health'],['business','Business'],['content','Content'],['relationship','Relationship'],['freedom','Freedom']];
function renderReview(){
  const r=week().review;
  return `
  <div class="phead">
    <div class="kicker">Sunday / Monday ritual</div>
    <h2>Weekly CEO Review</h2>
    <p class="serif">The key question: "Where am I drifting?"</p>
  </div>
  <div class="card" style="border-left:3px solid var(--accent)">
    <div class="field" style="margin-bottom:0">
      <label style="color:var(--accent)">⚑ Where am I drifting?</label>
      <textarea data-rev="drift" placeholder="Be honest. This is the whole point.">${esc(r.drift||'')}</textarea>
    </div>
  </div>
  ${REVIEW_Q.filter(x=>x[0]!=='drift').map(([id,lbl])=>`
    <div class="card" style="padding:16px 20px">
      <div class="field" style="margin-bottom:0">
        <label>${lbl}</label>
        <textarea data-rev="${id}" placeholder="...">${esc(r[id]||'')}</textarea>
      </div>
    </div>`).join('')}
  <div class="card">
    <div class="card-h"><h3>This Week's Domain Scores</h3><span class="sub">1–10</span></div>
    ${REVIEW_SCORES.map(([id,lbl])=>{
      const v=r['score_'+id]??5;
      return `<div class="score-row">
        <div class="name">${lbl}</div>
        <div class="slider">
          <input type="range" min="1" max="10" value="${v}" data-revscore="${id}">
          <span class="val ${scoreClass(v)}" data-revval="${id}">${v}</span>
        </div></div>`;
    }).join('')}
  </div>
  <p class="list-note">Each week is its own entry. Open this page next Monday and you start fresh — past reviews stay saved under the hood.</p>
  `;
}
function bindReview(){
  q('[data-rev]','all').forEach(el=>el.oninput=()=>{ week().review[el.dataset.rev]=el.value; save(); });
  q('[data-revscore]','all').forEach(el=>el.oninput=()=>{
    const id=el.dataset.revscore; week().review['score_'+id]=+el.value;
    const v=q(`[data-revval="${id}"]`); v.textContent=el.value; v.className='val '+scoreClass(+el.value); save(false);
  });
}

/* ---------- LIFE SCORECARD ---------- */
function renderScorecard(){
  const sc=week().scores;
  SCORE_AREAS.forEach(a=>{ if(sc[a]==null) sc[a]=5; });
  const vals=SCORE_AREAS.map(a=>sc[a]);
  const avg=(vals.reduce((x,y)=>x+y,0)/vals.length);
  const max=Math.max(...vals), min=Math.min(...vals);
  const strongest=SCORE_AREAS[vals.indexOf(max)];
  const weakest=SCORE_AREAS[vals.indexOf(min)];
  return `
  <div class="phead">
    <div class="kicker">Weekly snapshot · ${weekKey().replace('wk-','wk of ')}</div>
    <h2>Life Scorecard</h2>
    <p>Rate each 1–10. The numbers don't judge you — they show you where to point attention next week.</p>
  </div>
  <div class="grid2">
    <div class="card">
      <div class="card-h"><h3>Rate Each Area</h3><span class="sub">avg ${avg.toFixed(1)}</span></div>
      ${SCORE_AREAS.map(a=>{
        const v=sc[a];
        return `<div class="score-row">
          <div class="name">${a}</div>
          <div class="slider">
            <input type="range" min="1" max="10" value="${v}" data-sc="${a}">
            <span class="val ${scoreClass(v)}" data-scval="${a}">${v}</span>
          </div></div>`;
      }).join('')}
    </div>
    <div>
      <div class="card" style="text-align:center;padding-bottom:24px">
        <div class="card-h" style="justify-content:center"><h3>Week Average</h3></div>
        <div class="bigscore ${scoreClass(Math.round(avg))}">${avg.toFixed(1)}</div>
        <div style="color:var(--txt-faint);font-family:var(--mono);font-size:11px;margin-top:8px">out of 10 across ${SCORE_AREAS.length} areas</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Read-Out</h3></div>
        <div class="summary-grid">
          <div class="sumbox"><div class="lab">Strongest</div><div class="v g">${strongest}</div></div>
          <div class="sumbox"><div class="lab">Weakest</div><div class="v r">${weakest}</div></div>
          <div class="sumbox"><div class="lab">Biggest drift</div><div class="v a">${weakest} (${min}/10)</div></div>
          <div class="sumbox"><div class="lab">Top corrective action</div><div class="v" style="font-size:14px">Protect & rebuild ${weakest.toLowerCase()} this week</div></div>
        </div>
      </div>
    </div>
  </div>
  `;
}
function bindScorecard(){
  q('[data-sc]','all').forEach(el=>el.oninput=()=>{
    const a=el.dataset.sc; week().scores[a]=+el.value;
    const v=q(`[data-scval="${a}"]`); v.textContent=el.value; v.className='val '+scoreClass(+el.value);
    save(false); clearTimeout(window._scRe); window._scRe=setTimeout(rerender,500);
  });
}

