/* Test harness — EMULATOR ONLY.
   Refuses to run unless both emulators are configured and the project is a demo-*
   project (which can never reach production). Seeds users/{uid} from a copy of the
   real document (MM_REAL_DOC, a plain-JSON export kept outside the repo) or, if
   that isn't set, from a small synthetic fixture. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST not set. Use `npm test` (firebase emulators:exec).');
}
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'demo-marcomaster';
if (!PROJECT.startsWith('demo-')) throw new Error('Refusing to run against non-demo project ' + PROJECT);
if (process.env.TZ !== 'America/Toronto') throw new Error('Run with TZ=America/Toronto so the app code and the server agree on "today".');

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = getApps()[0] || initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const auth = getAuth(app);
// a SECOND Firestore client, standing in for a phone/laptop writing concurrently
const deviceApp = initializeApp({ projectId: PROJECT }, 'device');
const deviceDb = getFirestore(deviceApp);

const UID = 'OgEsKyNilhhmmh5FmwIQXh1qRwu1';
const ROOT = path.resolve(__dirname, '..', '..');
const userRef = (d = db) => d.collection('users').doc(UID);

function loadDoc(){
  if (process.env.MM_REAL_DOC) return { doc: JSON.parse(fs.readFileSync(process.env.MM_REAL_DOC, 'utf8')), real: true };
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: 'iseed' + i, txt: 'Seed task ' + i, kind: 'quick', done: false, priority: false, mins: 2, start: null, schedDate: null }));
  const marcomaster = { updatedAt: 1700000000000, days: {}, projects: [{ id: 'p1', name: 'Proj', color: '#f00', tasks: [{ id: 'pt1', txt: 'Write the brief', kind: 'quick', done: false }] }],
    leaks: [], followups: [], meetings: [], appointments: [], recurring: [], settings: {} };
  marcomaster.days['2000-01-01'] = { tasks };
  return { doc: { marcomaster, _updated: 1700000000000 }, real: false };
}
async function seed(mutate){
  const { doc } = loadDoc();
  if (mutate) mutate(doc.marcomaster);
  await userRef().set(doc);                      // full replace, extOps cleared
  return doc;
}
const read = async () => (await userRef().get()).data();

/* ---------- the REAL app code, in a sandbox (one per simulated device) ---------- */
// the app's own scripts, in index.html's load order. app.js is loaded too, minus
// its one boot line (init()), so tests can drive the real cloud reconciler.
const CLIENT_FILES = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="js\/([\w-]+)\.js/g)]
  .map(m => m[1]);
function device(){
  const noop = () => {};
  const el = new Proxy(function(){}, { get: (t, k) => k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : el, apply: () => el });
  const ctx = { console, setTimeout, clearTimeout, Date, Math, JSON, Promise,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el },
    navigator: {}, location: {}, addEventListener: noop };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of CLIENT_FILES) {
    let src = fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8');
    if (f === 'app') {
      if ((src.match(/^init\(\);$/gm) || []).length !== 1) throw new Error('app.js boot line changed — update the harness');
      src = src.replace(/^init\(\);$/m, '');
    }
    vm.runInContext(src, ctx, { filename: f + '.js' });
  }
  // stub the cloud I/O + UI side effects; everything else is the app's own code
  vm.runInContext(`__persisted=[]; persist=async(o)=>{ __persisted.push(o||{}); return true; };
    save=function(){}; toast=function(){}; rerender=function(){}; renderNav=function(){};
    setSyncStatus=function(){}; setSyncWarning=function(){}; morningReconcile=function(){};
    onCloudLooksEmptied=function(){};`, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return {
    ctx, run,
    /* what startApp does with a loaded copy, then render's day() */
    load(state){ ctx.__s = JSON.parse(JSON.stringify(state)); run('S=__s; seedDefaults(); day();'); },
    get S(){ return run('S'); },
    rows(){ const r = run('buildTaskRows()'); return [...r.quick, ...r.scheduled]; },
    completedToday(){ return run("completedRows('today')"); },
    firePicker(){ return run('taskGroups({splitKinds:false, bareLeaks:true})'); },
    todayKey(){ return run('todayKey()'); },
    replay(ops){ ctx.__ops = ops; return run('replayExtOps(__ops)'); },
    /* attach the REAL subscribeCloud() to a fake user doc; returns a function that
       delivers a snapshot of `doc` to it exactly as Firestore's onSnapshot would */
    subscribe(){
      run(`FB.user={uid:'${UID}'}; FB.db={}; __cb=null; Store.watchUserDoc=function(cb){ __cb=cb; return function(){}; }; subscribeCloud();`);
      return (doc) => { ctx.__doc = JSON.parse(JSON.stringify(doc)); run('__cb({exists:true, data:function(){ return __doc; }})'); };
    },
    persisted(){ return run('__persisted'); },
    /* exactly Store.set's cloud write for a real save: bump, then a blind merge-set */
    async push(d = deviceDb){
      run('S.updatedAt=nextVersion(S.updatedAt)');
      const S = JSON.parse(JSON.stringify(run('S')));
      await userRef(d).set({ marcomaster: S, _updated: S.updatedAt }, { merge: true });
    },
  };
}

/* ---------- the MCP app over real HTTP ---------- */
async function startServer(){
  const srv = http.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const { createApp } = require('../mcp/app');
  srv.on('request', createApp({ db, auth, uid: UID, baseUrl: base }));
  return { base, close: () => new Promise(r => srv.close(r)) };
}

const EMAIL = 'owner@example.test', PASSWORD = 'correct horse battery staple';
async function ensureUsers(){
  for (const u of [{ uid: UID, email: EMAIL }, { uid: 'someone-else', email: 'other@example.test' }]) {
    try { await auth.createUser({ uid: u.uid, email: u.email, password: PASSWORD }); } catch (e) { if (e.code !== 'auth/uid-already-exists') throw e; }
  }
}
async function signIn(email){
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }) });
  const j = await r.json(); if (!j.idToken) throw new Error('emulator sign-in failed ' + JSON.stringify(j));
  return j.idToken;
}

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const pkce = () => { const verifier = crypto.randomBytes(32).toString('base64url'); return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }; };
const form = (o) => new URLSearchParams(o).toString();

/* The whole connector handshake as Claude performs it. Returns intermediate values for negative tests. */
async function oauthConnect(base, { email = EMAIL, tamperVerifier = false } = {}){
  const reg = await (await fetch(base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: 'Claude', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
  const { verifier, challenge } = pkce();
  const authz = await fetch(base + '/authorize?' + form({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: base + '/mcp' }), { redirect: 'manual' });
  const html = await authz.text();
  const reqId = JSON.parse(html.match(/const REQ=("[^"]+")/)[1]);
  const idToken = await signIn(email);
  const ap = await fetch(base + '/oauth/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reqId, idToken }) });
  const apBody = await ap.json();
  if (ap.status !== 200) return { status: ap.status, apBody, reg };
  const redirect = new URL(apBody.redirect);
  const code = redirect.searchParams.get('code');
  const tok = await fetch(base + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, code_verifier: tamperVerifier ? verifier + 'x' : verifier, client_id: reg.client_id, redirect_uri: CALLBACK, resource: base + '/mcp' }) });
  return { status: 200, reg, redirect, code, verifier, tokStatus: tok.status, tokens: await tok.json(), html };
}

/* JSON-RPC over the stateless Streamable HTTP endpoint, as Claude sends it */
let rpcId = 0;
async function rpc(base, token, method, params){
  const r = await fetch(base + '/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token, 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const body = await r.text();
  return { status: r.status, headers: r.headers, json: body ? JSON.parse(body) : null };
}
async function callTool(base, token, name, args){
  const r = await rpc(base, token, 'tools/call', { name, arguments: args });
  if (r.status !== 200 || r.json.error) throw new Error('tool call failed ' + JSON.stringify(r.json));
  return { text: r.json.result.content.map(c => c.text).join('\n'), isError: !!r.json.result.isError };
}

module.exports = { db, deviceDb, auth, UID, ROOT, userRef, loadDoc, seed, read, device, startServer, ensureUsers, signIn,
  oauthConnect, rpc, callTool, CALLBACK, EMAIL };
