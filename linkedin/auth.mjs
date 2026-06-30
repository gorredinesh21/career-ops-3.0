// auth.mjs — one-time LinkedIn OAuth login. Starts a local callback server on :3000,
// prints the authorize URL (open it, approve), captures the code, exchanges for a token,
// fetches your member URN, and saves token.json. Run with NODE_OPTIONS=--use-system-ca.
import http from 'http';
import { randomBytes } from 'crypto';
import { authorizeUrl, exchangeCode, userinfo, saveToken, env } from './lib.mjs';

const state = randomBytes(8).toString('hex');
const url = authorizeUrl(state);
const port = new URL(env().LI_REDIRECT).port || 3000;

console.log('\n=== LinkedIn login ===');
console.log('Open this URL in your browser, sign in, and click Allow:\n');
console.log(url + '\n');
console.log(`(waiting for the callback on http://localhost:${port}/callback ...)`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) { res.writeHead(404); res.end('no'); return; }
  const q = new URL(req.url, `http://localhost:${port}`).searchParams;
  if (q.get('error')) {
    res.writeHead(400); res.end(`LinkedIn error: ${q.get('error')} ${q.get('error_description') || ''}`);
    console.error('Authorization denied/error:', q.get('error'), q.get('error_description'));
    server.close(); process.exit(1);
  }
  if (q.get('state') !== state) { res.writeHead(400); res.end('state mismatch'); console.error('State mismatch'); server.close(); process.exit(1); }
  try {
    const tok = await exchangeCode(q.get('code'));
    const info = await userinfo(tok.access_token);
    saveToken({
      access_token: tok.access_token,
      expires_at: Date.now() + (tok.expires_in || 5184000) * 1000,
      sub: info.sub, name: info.name, email: info.email,
    });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>LinkedIn connected ✅</h2><p>You can close this tab and return to the terminal.</p>');
    console.log(`\n✅ Logged in as ${info.name} (${info.email}). Token saved to linkedin/token.json`);
    console.log(`   Valid ~${Math.round((tok.expires_in || 5184000) / 86400)} days.`);
  } catch (e) {
    res.writeHead(500); res.end('error: ' + e.message);
    console.error('\n❌', e.message);
    server.close(); process.exit(1);
  }
  server.close(); process.exit(0);
});
server.listen(port);
