// Proxies a reddit-hosted avatar so the page never hotlinks and never leaks the viewer to reddit.
const OK = /^https:\/\/(styles\.redditmedia\.com|i\.redd\.it|www\.redditstatic\.com|preview\.redd\.it|external-preview\.redd\.it)\//;
export default async function handler(req, res) {
  const u = String((req.query && req.query.u) || '');
  if (!OK.test(u)) { res.status(400); return res.send('bad url'); }
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'edit.fun reader' } });
    if (!r.ok) { res.status(r.status); return res.send('no image'); }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', r.headers.get('content-type') || 'image/png');
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200); return res.send(buf);
  } catch (e) { res.status(502); return res.send('fetch failed'); }
}
