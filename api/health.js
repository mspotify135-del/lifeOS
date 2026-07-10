// Reads your Supabase and reports how many goals exist.
// Proves the whole chain works: browser -> Vercel function -> Supabase.

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    return res.status(200).json({ ok: false, error: 'missing env vars' });
  }

  try {
    const r = await fetch(`${url}/rest/v1/goals?select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      return res.status(200).json({ ok: false, error: 'supabase ' + r.status });
    }
    const rows = await r.json();
    return res.status(200).json({ ok: true, goals: rows.length });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
