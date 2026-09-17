// Reads a redditor live from reddit's public JSON. Nothing cached beyond the edge's 30s.
// Returns the account as reddit publishes it: avatar, karma, age, newest post.
const UA = 'edit.fun reader (contact: edit.fun)';
const clean = (u) => (u || '').replace(/&amp;/g, '&');

export default async function handler(req, res) {
  const raw = String((req.query && req.query.u) || '').trim().replace(/^u\//i, '').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(raw)) {
    return res.status(200).json({ ok: false, error: 'That is not a reddit username. 3–20 letters, numbers, _ or -.' });
  }
  const opts = { headers: { 'user-agent': UA, accept: 'application/json' } };
  // reddit answers 403 to some datacenter ranges on one host and not another; try three.
  const HOSTS = ['https://www.reddit.com', 'https://api.reddit.com', 'https://old.reddit.com'];
  async function get(path) {
    let last = null;
    for (const h of HOSTS) {
      try { const r = await fetch(h + path, opts); if (r.status === 404 || r.ok) return r; last = r; } catch (e) { last = null; }
    }
    return last;
  }
  try {
    const [a, s] = await Promise.all([
      get(`/user/${raw}/about.json?raw_json=1`),
      get(`/user/${raw}/submitted.json?sort=new&limit=1&raw_json=1`),
    ]);
    if (!a) return res.status(200).json({ ok: false, error: 'reddit did not answer. Try again in a moment.' });
    if (a.status === 404) return res.status(200).json({ ok: false, error: `u/${raw} does not exist on reddit.` });
    if (!a.ok) return res.status(200).json({ ok: false, error: `reddit answered ${a.status}. Try again in a moment.` });
    const about = await a.json();
    const d = about && about.data ? about.data : {};
    if (d.is_suspended) return res.status(200).json({ ok: false, error: `u/${raw} is suspended. Nothing can be gilded there.` });
    let newest = null;
    if (s && s.ok) {
      const sj = await s.json();
      const c = sj && sj.data && sj.data.children && sj.data.children[0] && sj.data.children[0].data;
      if (c) newest = { title: c.title, sub: c.subreddit_name_prefixed, ups: c.ups, created: c.created_utc * 1000, url: 'https://www.reddit.com' + c.permalink, locked: !!c.locked, archived: !!c.archived };
    }
    const icon = clean(d.snoovatar_img || d.icon_img || '');
    return res.status(200).json({
      ok: true,
      name: d.name || raw,
      icon: icon ? '/api/img?u=' + encodeURIComponent(icon) : '',
      karma: { post: d.link_karma || 0, comment: d.comment_karma || 0, total: d.total_karma || ((d.link_karma || 0) + (d.comment_karma || 0)) },
      created: (d.created_utc || 0) * 1000,
      verified: !!d.verified,
      premium: !!d.is_gold,
      newest,
      line: `gilds u/${d.name || raw} via EDIT`,
      url: `https://www.reddit.com/user/${d.name || raw}`,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'reddit did not answer. Try again in a moment.' });
  }
}
