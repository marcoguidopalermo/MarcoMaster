/* ============================================================
   VISION BOARD — one image, shown on the morning screen.

   WHY THIS IS NOT IN APP STATE. S is a single Firestore document with a 1MB cap,
   guarded by the startup gate and the catastrophic-shrink guard (see storage.js).
   Image bytes have no business anywhere near it: a base64 data URI would blow the
   cap outright, and even a small one would inflate every save and every backup.

   So the BYTES live in Cloud Storage at visionBoards/{uid}/… (UID-scoped in
   storage.rules, exactly like pushTokens/{uid} in firestore.rules), and app state
   holds nothing but a URL string:

     S.visionBoard = { url, path, updatedAt }   // ~400 bytes, three scalars

   That record is invisible to stateCount() — it sums array lengths only and has
   no branch that could ever see it — so adding or removing a vision board moves
   the shrink-guard's magnitude by exactly zero. It can neither trip the guard nor
   mask a real wipe. It saves through the ordinary save() path with both gates
   intact: no force, no direct FB.db write, no special casing.

   Uploads go through FB.storage, a different service from the state document. The
   only thing that ever touches S is the URL string, and only after the upload has
   actually succeeded.
   ============================================================ */

const VISION_MAX_EDGE = 1600;        // px on the long edge after resize
const VISION_QUALITY  = 0.82;        // JPEG quality — visually clean, ~150-400KB
const VISION_MAX_BYTES = 5*1024*1024; // hard client ceiling, mirroring storage.rules

let visionBusy=false;    // an upload is in flight
let visionPct=0;         // 0-100
let visionError='';      // last failure, shown inline

function visionBoard(){ return (S.visionBoard && S.visionBoard.url) ? S.visionBoard : null; }
function visionAvailable(){ return !!(FB && FB.storage && FB.user); }

/* ---------- resize ----------
   The original is NEVER uploaded. A 12MP phone photo becomes a ~200KB JPEG, which
   is the difference between an upload that feels instant and one that doesn't.
   createImageBitmap with imageOrientation:'from-image' applies EXIF rotation, so
   portrait iPhone shots don't land sideways; the <img> path is the fallback for
   browsers without it (modern Safari handles EXIF there natively). */
async function visionDecode(file){
  if(typeof createImageBitmap==='function'){
    try{ return await createImageBitmap(file, {imageOrientation:'from-image'}); }
    catch(e){ /* fall through */ }
    try{ return await createImageBitmap(file); }catch(e){ /* fall through */ }
  }
  return await new Promise((res,rej)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{ URL.revokeObjectURL(url); res(img); };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('decode-failed')); };
    img.src=url;
  });
}
async function visionResize(file){
  const src=await visionDecode(file);
  const w0=src.width||src.naturalWidth, h0=src.height||src.naturalHeight;
  if(!w0 || !h0) throw new Error('decode-failed');
  const scale=Math.min(1, VISION_MAX_EDGE/Math.max(w0,h0));
  const w=Math.max(1,Math.round(w0*scale)), h=Math.max(1,Math.round(h0*scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);   // flatten transparency, so PNGs don't go black on re-encode
  ctx.drawImage(src,0,0,w,h);
  if(src.close) try{ src.close(); }catch(e){}
  const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',VISION_QUALITY));
  if(!blob) throw new Error('encode-failed');
  return blob;
}

/* ---------- upload ----------
   State is written ONLY after getDownloadURL() resolves, so every failure path
   leaves the previous board exactly where it was. */
async function visionUpload(file, after){
  const repaint=()=>{ if(typeof after==='function') after(); };
  visionError=''; visionPct=0;
  if(!file){ return; }
  if(!visionAvailable()){ visionError='Sign in to upload.'; repaint(); return; }
  if(!/^image\//.test(file.type||'')){ visionError='That’s not an image file.'; repaint(); return; }

  visionBusy=true; repaint();
  let blob;
  try{
    blob=await visionResize(file);
  }catch(e){
    visionBusy=false; visionError='Could not read that image — try a different one.'; repaint(); return;
  }
  if(blob.size > VISION_MAX_BYTES){
    visionBusy=false;
    visionError='Still '+Math.round(blob.size/1048576)+'MB after resizing — too large.';
    repaint(); return;
  }

  const prev = S.visionBoard && S.visionBoard.path;
  const path = 'visionBoards/'+FB.user.uid+'/'+b()+'.jpg';
  try{
    const ref=FB.storage.ref(path);
    const task=ref.put(blob, {contentType:'image/jpeg', cacheControl:'public,max-age=31536000'});
    await new Promise((resolve,reject)=>{
      task.on('state_changed',
        sn=>{ visionPct = sn.totalBytes ? Math.round(sn.bytesTransferred/sn.totalBytes*100) : 0; repaint(); },
        reject, resolve);
    });
    const url=await ref.getDownloadURL();
    // ---- the ONLY write to app state: three scalars, through the normal path ----
    S.visionBoard={ url, path, updatedAt:Date.now() };
    save();
    // best-effort cleanup of the replaced object. A failure here leaves an orphan
    // in Storage, which is untidy but harmless — never fail the upload for it.
    if(prev && prev!==path){ try{ await FB.storage.ref(prev).delete(); }catch(e){} }
    visionBusy=false; visionPct=100; visionError='';
    repaint(); toast('Vision board updated ✓');
  }catch(e){
    visionBusy=false;
    visionError=visionErrMsg(e);
    repaint();
    console.error('vision upload failed', e);
  }
}
function visionErrMsg(e){
  const c=(e&&e.code)||'';
  if(c==='storage/unauthorized')  return 'Storage rules rejected it — are they deployed?';
  if(c==='storage/canceled')      return 'Upload cancelled.';
  if(c==='storage/quota-exceeded')return 'Storage quota is full.';
  if(c==='storage/unauthenticated')return 'Signed out mid-upload — sign in and retry.';
  if(c==='storage/unknown')       return 'Upload failed — check the bucket exists.';
  if(c==='storage/retry-limit-exceeded') return 'Upload timed out — check your connection.';
  return 'Upload failed — try again.';
}

/* Remove the board: clear state first (so the morning screen stops showing it even
   if the object delete fails), then delete the bytes best-effort. */
async function visionRemove(after){
  const cur=S.visionBoard;
  if(!cur){ return; }
  S.visionBoard=null; save();
  visionError=''; visionPct=0;
  if(typeof after==='function') after();
  if(cur.path && visionAvailable()){ try{ await FB.storage.ref(cur.path).delete(); }catch(e){ console.warn('vision delete failed', e); } }
  toast('Vision board removed');
}

/* ---------- the Settings block ---------- */
function renderVisionSettings(){
  const vb=visionBoard();
  return `
  <div class="card">
    <div class="card-h"><h3>Vision board</h3><span class="sub">shown on the morning screen</span></div>
    <p class="list-note" style="margin-top:0">One image. It's resized on this device before uploading and stored in your own private folder — never in the app-state document.</p>
    ${vb?`<div class="vb-preview"><img src="${esc(vb.url)}" alt="Vision board"
        onerror="this.closest('.vb-preview').classList.add('is-broken')"></div>`:''}
    ${visionBusy?`
      <div class="vb-progress"><div class="vb-bar" style="width:${visionPct}%"></div></div>
      <div class="vb-pct">Uploading… ${visionPct}%</div>`:`
      <div class="btn-row" style="margin-top:12px">
        <label class="btn ghost sm vb-pick">${vb?'Replace image':'Choose image'}
          <input type="file" accept="image/*" id="vbFile" hidden>
        </label>
        ${vb?`<button class="btn ghost sm" id="vbRemove">Remove</button>`:''}
      </div>`}
    ${visionError?`<div class="vb-err">${esc(visionError)}</div>`:''}
    ${!visionAvailable()&&!visionBusy?`<div class="vb-err">Cloud storage unavailable — reload while signed in.</div>`:''}
  </div>`;
}
function bindVisionSettings(){
  const f=q('#vbFile');
  if(f) f.onchange=()=>{
    const file=f.files && f.files[0];
    f.value='';                                  // so picking the same file twice still fires
    if(file) visionUpload(file, ()=>rerender());
  };
  const rm=q('#vbRemove');
  if(rm) rm.onclick=()=>{
    if(!confirm('Remove the vision board? The image is deleted from storage.')) return;
    visionRemove(()=>rerender());
  };
}
