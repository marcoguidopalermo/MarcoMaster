/* ============================================================
   MCP — single-user OAuth 2.1 provider for the Claude connector.
   The SDK's mcpAuthRouter does the protocol (metadata, dynamic client
   registration, PKCE verification, token endpoint, revocation); this file only
   decides WHO may get a token and stores the artefacts:
     • registration accepts ONLY Claude's own callback URLs, so a code can never be
       delivered anywhere else, whoever registers;
     • /authorize shows a sign-in page that uses the app's own Firebase email +
       password login; /oauth/approve issues a code only for a FRESH sign-in whose
       uid is the app's single user;
     • codes, access and refresh tokens are random, single-use where it matters, and
       stored only as SHA-256 hashes (a database read can't replay them).
   Collections (Admin SDK only — firestore.rules grants clients nothing here):
     mcpClients/{client_id}, mcpPending/{reqId}, mcpCodes/{hash}, mcpTokens/{hash}
   Kill switch: delete mcpTokens (every connection must sign in again).
   ============================================================ */
const crypto = require('crypto');
const { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

const ALLOWED_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]);
const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const FRESH_SIGNIN_S = 5 * 60;          // the ID token must come from a sign-in this recent
const SCOPE = 'tasks';

const rand = (prefix) => prefix + crypto.randomBytes(32).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* the app's public web config (the same object js/app.js ships to every browser) */
const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyA_NXXhonvWNjwq76Cv6oQJ5h4uFBTOqFc',
  authDomain: 'marcomaster-c4930.firebaseapp.com',
  projectId: 'marcomaster-c4930',
};

class MarcoOAuthProvider {
  constructor({ db, auth, uid, mcpUrl }){
    this.db = db; this.auth = auth; this.uid = uid; this.mcpUrl = mcpUrl;
    const col = (n) => db.collection(n);
    this.clients = col('mcpClients'); this.pending = col('mcpPending');
    this.codes = col('mcpCodes'); this.tokens = col('mcpTokens');
  }

  get clientsStore(){
    return {
      getClient: async (id) => {
        const s = await this.clients.doc(String(id)).get();
        return s.exists ? s.data().info : undefined;
      },
      registerClient: async (info) => {
        const uris = info.redirect_uris || [];
        if (!uris.length || !uris.every(u => ALLOWED_REDIRECTS.has(String(u)))) {
          throw new InvalidClientMetadataError('This server only accepts Claude as a client (redirect_uri must be Claude\'s callback).');
        }
        const clean = JSON.parse(JSON.stringify(info));      // drop undefined fields for Firestore
        await this.clients.doc(clean.client_id).set({ info: clean, createdAt: Date.now() });
        return clean;
      },
    };
  }

  /* Step 1: park the request and show the sign-in page. */
  async authorize(client, params, res){
    const reqId = crypto.randomBytes(24).toString('base64url');
    await this.pending.doc(reqId).set({
      clientId: client.client_id, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge,
      state: params.state ?? null, exp: Date.now() + PENDING_TTL_MS,
    });
    res.status(200).set('Content-Type', 'text/html; charset=utf-8')
      .set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' https://www.gstatic.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src https://marcomaster-c4930.firebaseapp.com; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'")
      .send(signInPage({ reqId, clientName: client.client_name || 'Claude', redirectHost: new URL(params.redirectUri).host }));
  }

  /* Step 2 (POST /oauth/approve): a fresh sign-in by the one allowed uid → code. */
  async approve({ reqId, idToken }){
    // identity first, so a wrong account / stale token doesn't burn the request
    let decoded;
    try { decoded = await this.auth.verifyIdToken(String(idToken || ''), true); }
    catch (e) { return { status: 401, body: { error: 'Sign-in could not be verified.' } }; }
    if (decoded.uid !== this.uid) return { status: 403, body: { error: 'This account is not allowed to connect.' } };
    if (Date.now() / 1000 - (decoded.auth_time || 0) > FRESH_SIGNIN_S) return { status: 401, body: { error: 'Please sign in again.' } };
    const pend = await this.takeOnce(this.pending.doc(String(reqId || '_')));
    if (!pend || pend.exp < Date.now()) return { status: 400, body: { error: 'This sign-in request expired. Start the connection again from Claude.' } };
    const code = rand('mmc_');
    await this.codes.doc(sha(code)).set({
      clientId: pend.clientId, redirectUri: pend.redirectUri, codeChallenge: pend.codeChallenge, exp: Date.now() + CODE_TTL_MS,
    });
    const to = new URL(pend.redirectUri);
    to.searchParams.set('code', code);
    if (pend.state != null) to.searchParams.set('state', pend.state);
    return { status: 200, body: { redirect: to.href } };
  }
  async deny({ reqId }){
    const pend = await this.takeOnce(this.pending.doc(String(reqId || '_')));
    if (!pend) return { status: 400, body: { error: 'Request expired.' } };
    const to = new URL(pend.redirectUri);
    to.searchParams.set('error', 'access_denied');
    if (pend.state != null) to.searchParams.set('state', pend.state);
    return { status: 200, body: { redirect: to.href } };
  }

  /* read-and-delete in one transaction: a code / pending request / refresh token works once */
  async takeOnce(ref){
    return this.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      tx.delete(ref);
      return s.data();
    });
  }

  async challengeForAuthorizationCode(client, code){
    const s = await this.codes.doc(sha(code)).get();
    const c = s.exists ? s.data() : null;
    if (!c || c.clientId !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('Invalid authorization code');
    return c.codeChallenge;
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri){
    // PKCE was already verified by the SDK against challengeForAuthorizationCode
    const c = await this.takeOnce(this.codes.doc(sha(code)));
    if (!c || c.clientId !== client.client_id || c.exp < Date.now()) throw new InvalidGrantError('Invalid authorization code');
    if (redirectUri && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch');
    return this.issue(client.client_id);
  }

  async exchangeRefreshToken(client, refreshToken){
    const t = await this.takeOnce(this.tokens.doc(sha(refreshToken)));     // rotation: the old one dies here
    if (!t || t.kind !== 'refresh' || t.clientId !== client.client_id || t.exp < Date.now() / 1000) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    return this.issue(client.client_id);
  }

  async issue(clientId){
    const now = Math.floor(Date.now() / 1000);
    const access = rand('mma_'), refresh = rand('mmr_');
    const batch = this.db.batch();
    batch.set(this.tokens.doc(sha(access)), { kind: 'access', clientId, uid: this.uid, exp: now + ACCESS_TTL_S, expireAt: new Date((now + ACCESS_TTL_S) * 1000) });
    batch.set(this.tokens.doc(sha(refresh)), { kind: 'refresh', clientId, uid: this.uid, exp: now + REFRESH_TTL_S, expireAt: new Date((now + REFRESH_TTL_S) * 1000) });
    await batch.commit();
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
  }

  async verifyAccessToken(token){
    const s = await this.tokens.doc(sha(token)).get();
    const t = s.exists ? s.data() : null;
    if (!t || t.kind !== 'access' || t.uid !== this.uid) throw new InvalidTokenError('Invalid access token');
    // expiry itself is enforced by the SDK's bearer middleware from expiresAt
    return { token, clientId: t.clientId, scopes: [SCOPE], expiresAt: t.exp, resource: this.mcpUrl, extra: { uid: t.uid } };
  }

  async revokeToken(_client, { token }){
    await this.tokens.doc(sha(token)).delete();
  }
}

function signInPage({ reqId, clientName, redirectHost }){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect MarcoMaster</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--txt:#1b1f24;--dim:#5b6470;--line:#d9dde3;--accent:#1f6feb;--red:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--panel:#161b22;--txt:#e6edf3;--dim:#8b949e;--line:#30363d;--accent:#58a6ff;--red:#f85149}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px;width:100%;max-width:380px}
h1{font-size:19px;margin:0 0 6px}p{color:var(--dim);margin:0 0 16px}b{color:var(--txt)}
label{display:block;font-size:13px;color:var(--dim);margin:10px 0 4px}
input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt);font:inherit}
.row{display:flex;gap:8px;margin-top:18px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);font:inherit;cursor:pointer;background:var(--bg);color:var(--txt)}
button.go{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}#err{color:var(--red);min-height:1.5em;margin-top:10px;font-size:14px}
</style></head><body><main class="card">
<h1>Connect MarcoMaster</h1>
<p><b>${esc(clientName)}</b> wants to read your tasks and add, complete and date them. You'll be returned to <b>${esc(redirectHost)}</b>.</p>
<form id="f"><label for="e">Email</label><input id="e" type="email" autocomplete="username" required>
<label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
<div class="row"><button type="button" id="no">Deny</button><button class="go" type="submit" id="ok">Sign in &amp; allow</button></div>
<div id="err" role="alert"></div></form></main>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
<script>
const REQ=${JSON.stringify(reqId)};
firebase.initializeApp(${JSON.stringify(FIREBASE_WEB_CONFIG)});
const auth=firebase.auth();
const err=m=>{document.getElementById('err').textContent=m||'';};
async function post(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(j.redirect){ location.assign(j.redirect); return; }
  err(j.error||'Something went wrong.');
}
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault(); err(''); const b=document.getElementById('ok'); b.disabled=true;
  try{
    await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const c=await auth.signInWithEmailAndPassword(document.getElementById('e').value.trim(),document.getElementById('p').value);
    const idToken=await c.user.getIdToken();
    await auth.signOut();
    await post('/oauth/approve',{reqId:REQ,idToken});
  }catch(x){ err('Sign-in failed — check your email and password.'); }
  b.disabled=false;
};
document.getElementById('no').onclick=()=>post('/oauth/deny',{reqId:REQ});
</script></body></html>`;
}

module.exports = { MarcoOAuthProvider, ALLOWED_REDIRECTS, sha };
