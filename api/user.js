// Reads a redditor live. Three readers, in order:
//  1. reddit's OAuth API (needs REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in the environment)
//  2. reddit's public JSON on three hosts (reddit refuses some datacenter ranges with 403)
//  3. pullpush.io, an independent archive of reddit submissions (newest post only, no karma, no avatar)
// The response says which reader answered in `via`, and what it could not read in `partial`.
const UA = 'web:edit.fun:1.0 (reader; contact via x.com/EditDotFun)';
const clean = (u) => (u || '').replace(/&amp;/g, '&');
const HOSTS = ['https://www.reddit.com', 'https://api.reddit.com', 'https://old.reddit.com'];
let TOKEN = { v: '', exp: 0 };

async function token() {
  const id = process.env.REDDIT_CLIENT_ID, sec = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !sec) return '';
  if (TOKEN.v && Date.now() < TOKEN.exp - 60000) return TOKEN.v;
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { 'user-agent': UA, authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) return '';
  const j = await r.json();
  TOKEN = { v: j.access_token || '', exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return TOKEN.v;
}

function shapeUser(d, raw) {
  const icon = clean(d.snoovatar_img || d.icon_img || '');
  return {
    name: d.name || raw,
    icon: icon ? '/api/img?u=' + encodeURIComponent(icon) : '',
    karma: { post: d.link_karma || 0, comment: d.comment_karma || 0, total: d.total_karma || ((d.link_karma || 0) + (d.comment_karma || 0)) },
    created: (d.created_utc || 0) * 1000,
    verified: !!d.verified, premium: !!d.is_gold, suspended: !!d.is_suspended,
  };
}
function shapePost(c) {
  if (!c) return null;
  return { title: c.title, sub: c.subreddit_name_prefixed || ('r/' + c.subreddit), ups: c.ups || c.score || 0, created: (c.created_utc || 0) * 1000,
    url: c.permalink ? 'https://www.reddit.com' + c.permalink : (c.url || ''), locked: !!c.locked, archived: !!c.archived };
}

async function viaOAuth(raw) {
  const t = await token(); if (!t) return null;
  const h = { 'user-agent': UA, authorization: 'Bearer ' + t };
  const [a, s] = await Promise.all([
    fetch(`https://oauth.reddit.com/user/${raw}/about?raw_json=1`, { headers: h }),
    fetch(`https://oauth.reddit.com/user/${raw}/submitted?sort=new&limit=1&raw_json=1`, { headers: h }),
  ]);
  if (a.status === 404) return { missing: true };
  if (!a.ok) return null;
  const about = await a.json(); const sj = s.ok ? await s.json() : null;
  const c = sj && sj.data && sj.data.children && sj.data.children[0] && sj.data.children[0].data;
  return { user: shapeUser(about.data || {}, raw), newest: shapePost(c), via: 'reddit oauth' };
}

async function viaPublic(raw) {
  const opts = { headers: { 'user-agent': UA, accept: 'application/json' } };
  for (const host of HOSTS) {
    try {
      const a = await fetch(`${host}/user/${raw}/about.json?raw_json=1`, opts);
      if (a.status === 404) return { missing: true };
      if (!a.ok) continue;
      const about = await a.json();
      let c = null;
      try { const s = await fetch(`${host}/user/${raw}/submitted.json?sort=new&limit=1&raw_json=1`, opts); if (s.ok) { const sj = await s.json(); c = sj.data.children[0] && sj.data.children[0].data; } } catch (e) {}
      return { user: shapeUser(about.data || {}, raw), newest: shapePost(c), via: 'reddit public json' };
    } catch (e) {}
  }
  return null;
}

async function viaPullpush(raw) {
  try {
    const r = await fetch(`https://api.pullpush.io/reddit/search/submission/?author=${encodeURIComponent(raw)}&size=1&sort=desc`, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    const j = await r.json(); const c = j && j.data && j.data[0];
    if (!c) return { missing: true };
    return { user: { name: c.author || raw, icon: '', karma: null, created: 0, verified: false, premium: false, suspended: false }, newest: shapePost(c), via: 'pullpush archive', partial: 'karma and avatar not readable right now' };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const raw = String((req.query && req.query.u) || '').trim().replace(/^u\//i, '').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(raw)) {
    return res.status(200).json({ ok: false, error: 'That is not a reddit username. 3–20 letters, numbers, _ or -.' });
  }
  let r = null;
  try { r = await viaOAuth(raw); } catch (e) { r = null; }
  if (!r) { try { r = await viaPublic(raw); } catch (e) { r = null; } }
  if (!r) { try { r = await viaPullpush(raw); } catch (e) { r = null; } }
  if (!r) return res.status(200).json({ ok: false, error: 'reddit is refusing reads from our server right now, and the archive did not answer either. Try again in a minute.' });
  if (r.missing) return res.status(200).json({ ok: false, error: `u/${raw} does not exist on reddit, or has never posted.` });
  if (r.user.suspended) return res.status(200).json({ ok: false, error: `u/${raw} is suspended. Nothing can be gilded there.` });
  return res.status(200).json({
    ok: true, ...r.user, newest: r.newest, via: r.via, partial: r.partial || '',
    line: `gilds u/${r.user.name} via EDIT`, url: `https://www.reddit.com/user/${r.user.name}`,
  });
}
