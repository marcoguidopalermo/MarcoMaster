/* ============================================================
   MCP — the HTTP app behind exports.mcp.
     /.well-known/*, /authorize, /token, /register, /revoke — OAuth (SDK router)
     /oauth/approve, /oauth/deny                          — our sign-in page's calls
     POST /mcp                                            — Streamable HTTP, stateless, Bearer-protected
   Served at the ROOT of the function's Cloud Run URL (https://mcp-….a.run.app),
   because OAuth discovery needs /.well-known/ at the origin root.
   ============================================================ */
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const logger = require('firebase-functions/logger');
const { MarcoOAuthProvider } = require('./oauth');
const { buildServer } = require('./tools');

function createApp({ db, auth, uid, baseUrl }){
  const mcpUrl = new URL('/mcp', baseUrl);
  const provider = new MarcoOAuthProvider({ db, auth, uid, mcpUrl });
  const app = express();
  app.set('trust proxy', 1);                       // Cloud Run's front end sets X-Forwarded-For (rate limits key on it)
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.use(mcpAuthRouter({
    provider, issuerUrl: new URL(baseUrl), resourceServerUrl: mcpUrl,
    scopesSupported: ['tasks'], resourceName: 'MarcoMaster',
  }));

  const approveLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const reply = (fn) => async (req, res) => {
    try { const r = await fn(req.body || {}); res.status(r.status).json(r.body); }
    catch (e) { logger.error('oauth approve failed', { err: e && (e.stack || e.message) }); res.status(500).json({ error: 'Server error.' }); }
  };
  app.post('/oauth/approve', approveLimit, express.json(), reply(b => provider.approve(b)));
  app.post('/oauth/deny', approveLimit, express.json(), reply(b => provider.deny(b)));

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    expectedResource: mcpUrl,
  });
  app.post('/mcp', bearer, express.json({ limit: '256kb' }), async (req, res) => {
    const server = buildServer({ db, uid });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      logger.error('mcp request failed', { err: e && (e.stack || e.message) });
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  // stateless server: no SSE stream to GET, no session to DELETE
  app.all('/mcp', bearer, (req, res) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });
  return app;
}

module.exports = { createApp };
