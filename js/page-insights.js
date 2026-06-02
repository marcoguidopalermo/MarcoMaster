/* ============================================================
   MARCOINSIGHTS — compile tracked data into patterns
   Pure inline SVG charts (no libraries). Reads S.days / S.weeks.
   ============================================================ */

/* ---- data aggregation ---- */
function insightDays(n){
  // returns last n days that have any data, oldest→newest, as {key,d}
  const keys=Object.keys(S.days).sort();
  return keys.slice(-n).map(k=>({key:k,d:S.days[k]}));
}
function dayDoneCount(d){ return (d.archive?.length||0)+(d.tasks?.filter(t=>t.done).length||0); }
function dayAvgEnergy(d){
  const ci=d.checkins||[]; if(!ci.length){ return energyToNum(d.energy); }
  const vals=ci.map(c=>energyToNum(c.energy)).filter(v=>v); if(!vals.length) return energyToNum(d.energy);
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function parseSleepHours(str){
  if(!str) return null; const m=String(str).match(/(\d+(\.\d+)?)/); return m?parseFloat(m[1]):null;
}
function mean(arr){ const v=arr.filter(x=>x!=null&&!isNaN(x)); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; }

function renderInsights(){
  const all=insightDays(30);
  const today=day();
  const hist=all.filter(x=>x.key!==todayKey());     // prior days for averages
  // metrics
  const doneSeries=all.map(x=>({k:x.key,v:dayDoneCount(x.d)}));
  const energySeries=all.map(x=>({k:x.key,v:dayAvgEnergy(x.d)}));
  const sleepSeries=all.map(x=>({k:x.key,v:parseSleepHours(x.d.sleep)}));

  const avgDone=mean(hist.map(x=>dayDoneCount(x.d)));
  const avgEnergy=mean(hist.map(x=>dayAvgEnergy(x.d)));
  const avgSleep=mean(hist.map(x=>parseSleepHours(x.d.sleep)));

  const todayDone=dayDoneCount(today);
  const todayEnergy=dayAvgEnergy(today);
  const todaySleep=parseSleepHours(today.sleep);
  const sleepLastNight = (()=>{ const prev=hist[hist.length-1]; return prev?parseSleepHours(prev.d.sleep):null; })();

  // scorecard trend across weeks
  const wkeys=Object.keys(S.weeks).sort();
  const scoreWeeks=wkeys.slice(-8).map(k=>{
    const sc=S.weeks[k].scores||{}; const vals=SCORE_AREAS.map(a=>sc[a]).filter(v=>v!=null);
    return {k,avg:vals.length?mean(vals):null,scores:sc};
  });
  // latest scorecard area breakdown
  const latestWk=wkeys.length?S.weeks[wkeys[wkeys.length-1]].scores||{}:{};

  // drift themes from weekly reviews
  const drifts=wkeys.map(k=>S.weeks[k].review?.drift).filter(x=>x&&x.trim());

  return `
  <div class="phead">
    <div class="kicker">Patterns · last ${all.length} day${all.length===1?'':'s'} tracked</div>
    <h2>MarcoInsights</h2>
    <p>Your data, read back to you. The more you log mood, energy, sleep and check things off, the sharper this gets. <span class="serif">"I do not trust memory. I trust systems."</span></p>
  </div>

  ${all.length<2?`<div class="card"><div class="empty">Not enough history yet. Log a few days of energy, mood, sleep and completed tasks — patterns appear here automatically from day two onward.</div></div>`:''}

  <div class="ins-summary card">
    <div class="card-h"><h3>Plain-Language Read</h3></div>
    <div class="read-list">${plainLanguageRead({avgDone,avgEnergy,avgSleep,todayDone,todayEnergy,todaySleep,sleepLastNight,energySeries,sleepSeries,doneSeries,drifts,scoreWeeks,latestWk})}</div>
  </div>

  <div class="grid3">
    ${metricCard('Tasks done today',todayDone,avgDone,'',false)}
    ${metricCard('Energy today',todayEnergy,avgEnergy,'/3',false)}
    ${metricCard('Sleep last night',sleepLastNight,avgSleep,'h',false)}
  </div>

  <div class="card">
    <div class="card-h"><h3>Energy Trend</h3><span class="sub">avg per day · 1–3</span></div>
    ${lineChart(energySeries,1,3,'var(--amber)')}
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-h"><h3>Tasks Completed</h3><span class="sub">per day</span></div>
      ${barChart(doneSeries,'var(--accent)')}
    </div>
    <div class="card">
      <div class="card-h"><h3>Sleep Hours</h3><span class="sub">night before</span></div>
      ${lineChart(sleepSeries,3,10,'var(--blue)')}
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Mood Log</h3><span class="sub">recent words</span></div>
    ${moodCloud(all)}
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-h"><h3>Scorecard Trend</h3><span class="sub">weekly avg · 1–10</span></div>
      ${scoreWeeks.filter(w=>w.avg!=null).length>1?lineChart(scoreWeeks.map(w=>({k:w.k,v:w.avg})),1,10,'var(--green)'):'<div class="empty">Fill the Life Scorecard for a couple of weeks to see the trend.</div>'}
    </div>
    <div class="card">
      <div class="card-h"><h3>Latest Scorecard</h3><span class="sub">by area</span></div>
      ${Object.keys(latestWk).length?areaBars(latestWk):'<div class="empty">No scorecard filled yet.</div>'}
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>Drift Themes</h3><span class="sub">from weekly reviews</span></div>
    ${drifts.length?`<div class="drift-list">${drifts.slice(-6).reverse().map(x=>`<div class="drift-entry">"${esc(x)}"</div>`).join('')}</div>
      <p class="inbox-rule" style="margin-bottom:0">Re-read these together. Repeated words are where your system needs reinforcing — not where you need more willpower.</p>`
    :'<div class="empty">Answer "Where did I drift?" in the Weekly CEO Review and themes collect here.</div>'}
  </div>

  <div class="card">
    <div class="card-h"><h3>Day Log</h3><span class="sub">accomplishments by day</span></div>
    ${dayLogTable(all)}
  </div>
  `;
}

/* ---- plain-language engine ---- */
function plainLanguageRead(x){
  const lines=[];
  const cmp=(t,a,unit,label)=>{
    if(t==null||a==null) return null;
    const diff=t-a; const pct=a?Math.round(Math.abs(diff)/a*100):0;
    if(Math.abs(diff)<0.01) return `Your ${label} today is right on your ${all0(a,unit)} average.`;
    return `Your ${label} today (${num(t)}${unit}) is ${diff>0?'above':'below'} your average of ${num(a)}${unit}${pct?` (${pct}% ${diff>0?'higher':'lower'})`:''}.`;
  };
  let l;
  if((l=cmp(x.todayDone,x.avgDone,'','task completion'))) lines.push(l);
  if((l=cmp(x.todayEnergy,x.avgEnergy,'/3','energy'))) lines.push(l);

  // sleep ↔ energy correlation (rough)
  const pairs=[]; for(let i=1;i<x.energySeries.length;i++){
    const s=x.sleepSeries[i-1]?.v, e=x.energySeries[i]?.v;
    if(s!=null&&e!=null) pairs.push([s,e]);
  }
  if(pairs.length>=4){
    const hi=pairs.filter(p=>p[0]>=mean(pairs.map(p=>p[0])));
    const lo=pairs.filter(p=>p[0]<mean(pairs.map(p=>p[0])));
    const ehi=mean(hi.map(p=>p[1])), elo=mean(lo.map(p=>p[1]));
    if(ehi!=null&&elo!=null&&Math.abs(ehi-elo)>0.25){
      lines.push(`Pattern: on better-sleep nights your next-day energy averages ${ehi.toFixed(1)}/3 vs ${elo.toFixed(1)}/3 after lighter sleep. Sleep is moving your energy.`);
    }
  }

  // best/worst recent day
  const done=x.doneSeries.filter(d=>d.v>0);
  if(done.length>=3){
    const best=done.reduce((a,b)=>b.v>a.v?b:a);
    lines.push(`Most productive recent day: ${prettyKey(best.k)} (${best.v} done).`);
  }

  // scorecard weakest
  if(Object.keys(x.latestWk).length){
    const entries=Object.entries(x.latestWk);
    const weak=entries.reduce((a,b)=>b[1]<a[1]?b:a);
    lines.push(`Weakest scorecard area right now: ${weak[0]} (${weak[1]}/10) — your prime corrective target.`);
  }

  // drift recurrence
  if(x.drifts.length>=2){
    const words={};
    x.drifts.join(' ').toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).forEach(w=>{ if(w.length>4) words[w]=(words[w]||0)+1; });
    const rep=Object.entries(words).filter(([w,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,3);
    if(rep.length) lines.push(`Recurring drift word${rep.length>1?'s':''}: ${rep.map(r=>`"${r[0]}" (×${r[1]})`).join(', ')}. Build a system around this, not more discipline.`);
  }

  if(!lines.length) lines.push('Keep logging — once you have a few days of energy, sleep and completions, real patterns surface here.');
  return lines.map(t=>`<div class="read-line">→ ${t}</div>`).join('');
}
function num(v){ return v==null?'—':(Math.round(v*10)/10); }
function all0(v,u){ return num(v)+u; }
function prettyKey(k){ const [y,m,dd]=k.split('-'); return new Date(y,m-1,dd).toLocaleDateString('en-CA',{month:'short',day:'numeric'}); }

/* ---- metric card: today vs average ---- */
function metricCard(label,today,avg,unit,inv){
  const has=today!=null;
  let cls='', arrow='', diffTxt='vs avg —';
  if(has&&avg!=null){
    const diff=today-avg;
    if(Math.abs(diff)<0.05){ cls='mid'; arrow='='; diffTxt='on average'; }
    else { const up=diff>0; cls=(up!==inv)?'high':'low'; arrow=up?'▲':'▼'; diffTxt=`${up?'+':''}${num(diff)}${unit} vs avg ${num(avg)}${unit}`; }
  }
  return `<div class="card metric-card">
    <div class="mc-lab">${label}</div>
    <div class="mc-val">${has?num(today)+unit:'—'}</div>
    <div class="mc-diff ${cls}">${arrow} ${diffTxt}</div>
  </div>`;
}

/* ---- SVG line chart ---- */
function lineChart(series,min,max,color){
  const pts=series.filter(p=>p.v!=null);
  if(pts.length<2) return '<div class="empty">Need at least 2 days of data.</div>';
  const W=560,H=130,pad=20;
  const n=series.length;
  const x=i=>pad+(i/(n-1))*(W-pad*2);
  const y=v=>H-pad-((v-min)/(max-min))*(H-pad*2);
  let d='',dots='';
  let started=false;
  series.forEach((p,i)=>{
    if(p.v==null) return;
    const px=x(i),py=y(p.v);
    d+=(started?'L':'M')+px.toFixed(1)+' '+py.toFixed(1)+' '; started=true;
    dots+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${color}"/>`;
  });
  // axis ticks
  const mid=(min+max)/2;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${y(max)}" x2="${W-pad}" y2="${y(max)}" stroke="var(--line-soft)"/>
    <line x1="${pad}" y1="${y(mid)}" x2="${W-pad}" y2="${y(mid)}" stroke="var(--line-soft)" stroke-dasharray="2 4"/>
    <line x1="${pad}" y1="${y(min)}" x2="${W-pad}" y2="${y(min)}" stroke="var(--line-soft)"/>
    <text x="2" y="${y(max)+4}" class="ctick">${max}</text>
    <text x="2" y="${y(min)+4}" class="ctick">${min}</text>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
  </svg>
  <div class="chart-x">${chartXLabels(series)}</div>`;
}

/* ---- SVG bar chart ---- */
function barChart(series,color){
  const pts=series.filter(p=>p.v!=null);
  if(!pts.length) return '<div class="empty">No data yet.</div>';
  const W=560,H=130,pad=20;
  const n=series.length;
  const max=Math.max(1,...series.map(p=>p.v||0));
  const bw=(W-pad*2)/n*0.62;
  const step=(W-pad*2)/n;
  let bars='';
  series.forEach((p,i)=>{
    const v=p.v||0;
    const h=((v)/(max))*(H-pad*2);
    const bx=pad+i*step+(step-bw)/2;
    const by=H-pad-h;
    bars+=`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="2" fill="${color}" opacity="${v?1:0.15}"/>`;
    if(v) bars+=`<text x="${(bx+bw/2).toFixed(1)}" y="${(by-4).toFixed(1)}" class="cval">${v}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="var(--line-soft)"/>${bars}
  </svg><div class="chart-x">${chartXLabels(series)}</div>`;
}
function chartXLabels(series){
  const n=series.length; const showEvery=Math.ceil(n/7);
  return series.map((p,i)=>`<span style="flex:1;text-align:center">${i%showEvery===0?prettyKey(p.k).replace(/^[A-Za-z]+ /,'')||p.k.slice(-2):''}</span>`).join('');
}

/* ---- area bars (scorecard breakdown) ---- */
function areaBars(scores){
  return SCORE_AREAS.map(a=>{
    const v=scores[a]; if(v==null) return '';
    const cls=v<=4?'low':v<=7?'mid':'high';
    return `<div class="abar"><span class="abar-lab">${a}</span><div class="abar-track"><div class="abar-fill ${cls}" style="width:${v*10}%"></div></div><span class="abar-v">${v}</span></div>`;
  }).join('');
}

/* ---- mood cloud ---- */
function moodCloud(all){
  const counts={};
  all.forEach(x=>{
    (x.d.checkins||[]).forEach(c=>{ if(c.mood) c.mood.toLowerCase().split(/[\s,]+/).forEach(w=>{ if(w) counts[w]=(counts[w]||0)+1; }); });
    if(x.d.mood) x.d.mood.toLowerCase().split(/[\s,]+/).forEach(w=>{ if(w) counts[w]=(counts[w]||0)+1; });
  });
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,24);
  if(!entries.length) return '<div class="empty">Log mood words in your Energy & Mood Log and they collect here.</div>';
  const max=entries[0][1];
  return `<div class="mood-cloud">${entries.map(([w,c])=>{
    const size=13+(c/max)*16;
    const op=0.55+(c/max)*0.45;
    return `<span class="mood-word" style="font-size:${size.toFixed(0)}px;opacity:${op.toFixed(2)}">${esc(w)}${c>1?`<sub>${c}</sub>`:''}</span>`;
  }).join('')}</div>`;
}

/* ---- day log table ---- */
function dayLogTable(all){
  const rows=[...all].reverse().slice(0,14);
  return `<div class="daylog">
    ${rows.map(x=>{
      const d=x.d; const done=dayDoneCount(d); const e=dayAvgEnergy(d);
      return `<div class="dl-row">
        <span class="dl-date">${prettyKey(x.key)}</span>
        <span class="dl-energy ${e!=null?(e<1.7?'low':e<2.4?'mid':'high'):''}">${e!=null?'E '+e.toFixed(1):'—'}</span>
        <span class="dl-mood">${esc(d.mood||(d.checkins?.[0]?.mood)||'—')}</span>
        <span class="dl-done">${done} done</span>
        <span class="dl-sleep">${d.sleep?esc(d.sleep):'—'}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function bindInsights(){ /* charts are static SVG; nothing interactive needed */ }
