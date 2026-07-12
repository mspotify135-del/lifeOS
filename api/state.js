// Read-only snapshot of live data for the interface's deeper layers.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sb(table, query = "") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }
  try {
    const [phases, goals, calendar, requirements] = await Promise.all([
      sb("phase"), sb("goals"),
      sb("calendar_events", "order=starts_at.asc"),
      sb("requirements", "order=window_closes.asc"),
    ]);
    res.status(200).json({ ok: true, phases, goals, calendar, requirements });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
}
