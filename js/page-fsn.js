/* ============================================================
   FUTURE SELF NARRATIVE (FSN) — a dedicated reading view.
   Built for READING, not managing: a comfortable measure, generous
   line height, calm typography. A toggle switches between the Full
   narrative, a Condensed version, and Principles. Editing lives in
   Settings; this view is where the morning re-read happens.
   ============================================================ */
let fsnView='full';   // 'full' | 'condensed' | 'principles'

const FSN_TABS=[
  ['full','Full'],
  ['condensed','Condensed'],
  ['principles','Principles'],
];

/* plain text → readable HTML: escape, blank lines split paragraphs, single
   newlines become <br> so line breaks and paragraphs survive intact. */
function fsnTextHtml(str){
  const t=(str||'').replace(/\r\n/g,'\n').trim();
  if(!t) return '';
  return t.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
}

function renderFSN(){
  const n=S.narrative||{full:'',condensed:'',principles:''};
  if(!FSN_TABS.some(([k])=>k===fsnView)) fsnView='full';
  const body=fsnTextHtml(n[fsnView]);
  const label=(FSN_TABS.find(([k])=>k===fsnView)||[])[1]||'';
  return `
  <div class="fsn-wrap">
    <div class="phead compact">
      <div class="kicker">Read this first</div>
      <h2>Future Self Narrative</h2>
    </div>
    <div class="fsn-toggle">
      ${FSN_TABS.map(([k,lbl])=>`<button class="fsn-tab ${fsnView===k?'active':''}" data-fsntab="${k}">${lbl}</button>`).join('')}
    </div>
    <div class="fsn-reader">
      ${body || `<div class="empty">No ${esc(label.toLowerCase())} narrative yet — write one in Settings → Future Self Narrative.</div>`}
    </div>
  </div>`;
}

function bindFSN(){
  q('[data-fsntab]','all').forEach(el=>el.onclick=()=>{ fsnView=el.dataset.fsntab; rerender(); });
}
