// lib.mjs — LinkedIn official-API helpers (OAuth + text/image post). Zero deps; uses Node fetch.
// Run scripts with NODE_OPTIONS=--use-system-ca so the corporate (Zscaler) TLS cert is trusted.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(HERE, 'token.json');

export function env() {
  const e = {};
  for (const l of readFileSync(path.join(HERE, '.env'), 'utf-8').split('\n')) {
    const s = l.trim();
    if (s && !s.startsWith('#') && s.includes('=')) { const [k, ...v] = s.split('='); e[k.trim()] = v.join('=').trim(); }
  }
  return e;
}

export function loadToken() {
  return existsSync(TOKEN_PATH) ? JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')) : null;
}
export function saveToken(t) { writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2), 'utf-8'); }

export const SCOPES = 'openid profile email w_member_social';

export function authorizeUrl(state) {
  const e = env();
  const p = new URLSearchParams({
    response_type: 'code', client_id: e.LI_CLIENT_ID,
    redirect_uri: e.LI_REDIRECT, scope: SCOPES, state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
}

export async function exchangeCode(code) {
  const e = env();
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: e.LI_REDIRECT,
    client_id: e.LI_CLIENT_ID, client_secret: e.LI_CLIENT_SECRET,
  });
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function userinfo(accessToken) {
  const r = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo ${r.status}: ${await r.text()}`);
  return r.json(); // { sub, name, email, ... }
}

// Return a valid token or throw with a clear next step.
function requireToken() {
  const t = loadToken();
  if (!t) throw new Error('Not authenticated — run: node linkedin/auth.mjs');
  if (t.expires_at && Date.now() > t.expires_at) throw new Error('Token expired — re-run linkedin/auth.mjs');
  return t;
}

// Guess the HTTP content-type for an image file from its extension.
const IMG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
function imageContentType(file) {
  const ext = path.extname(file).toLowerCase();
  const ct = IMG_TYPES[ext];
  if (!ct) throw new Error(`Unsupported image type "${ext}" for ${file} (use png/jpg/gif/webp)`);
  return ct;
}

// Step 1: register an upload slot. Returns { uploadUrl, asset } (asset = urn:li:digitalmediaAsset:...).
async function registerImageUpload(token, author) {
  const body = {
    registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      owner: author,
      serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
    },
  };
  const r = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`registerUpload failed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const uploadUrl = j?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset = j?.value?.asset;
  if (!uploadUrl || !asset) throw new Error(`registerUpload: unexpected response ${JSON.stringify(j)}`);
  return { uploadUrl, asset };
}

// Step 2: PUT the raw image bytes to the registered upload URL.
async function uploadImageBytes(token, uploadUrl, file) {
  const bytes = readFileSync(file);
  const r = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': imageContentType(file) },
    body: bytes,
  });
  if (!r.ok) throw new Error(`image upload failed ${r.status}: ${await r.text()}`);
}

// Upload one local image and return its asset URN, ready to attach to a post.
async function uploadImage(token, author, file) {
  if (!existsSync(file)) throw new Error(`Image not found: ${file}`);
  const { uploadUrl, asset } = await registerImageUpload(token, author);
  await uploadImageBytes(token, uploadUrl, file);
  return asset;
}

// Create a UGC share. `imagePaths` (optional) is a list of local image files to attach.
// With 0 images it posts plain text; with 1+ it posts an IMAGE share. Needs w_member_social.
async function createPost(text, imagePaths = []) {
  const t = requireToken();
  const author = `urn:li:person:${t.sub}`;

  const share = { shareCommentary: { text }, shareMediaCategory: 'NONE' };
  if (imagePaths.length) {
    const media = [];
    for (const file of imagePaths) {
      const asset = await uploadImage(t, author, file);
      media.push({ status: 'READY', media: asset, title: { text: path.basename(file) } });
    }
    share.shareMediaCategory = 'IMAGE';
    share.media = media;
  }

  const payload = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': share },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`post failed ${r.status}: ${await r.text()}`);
  return { id: r.headers.get('x-restli-id') || r.headers.get('x-linkedin-id') || '(created)' };
}

// Post a plain-text share (needs w_member_social).
export async function createTextPost(text) {
  return createPost(text, []);
}

// Post a share with one or more local images attached (needs w_member_social).
//   createImagePost(text, 'path/to/img.png')           // single
//   createImagePost(text, ['a.png', 'b.jpg'])           // multiple
export async function createImagePost(text, images) {
  const imagePaths = Array.isArray(images) ? images : [images];
  if (!imagePaths.length) throw new Error('createImagePost needs at least one image path');
  return createPost(text, imagePaths);
}

// Extract one day's post body from the content calendar (matched by YYYY-MM-DD).
export function calendarEntry(dateStr) {
  const md = readFileSync(path.join(HERE, 'content-calendar.md'), 'utf-8');
  const re = new RegExp(`### Day \\d+ — ${dateStr}[^\\n]*\\n([\\s\\S]*?)\\n---`, 'm');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}
