// Fetches the secret iCal feed, parses events, writes upcoming + last 14 days to Supabase.
// Visit /api/sync-calendar to run.

const ICS_URL = process.env.CALENDAR_ICS_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// iCal dates come as 20260713T090000Z or 20260713 (all-day). Convert to ISO.
function parseICSDate(val) {
  if (!val) return null;
  const clean = val.replace(/[^0-9TZ]/g, "");
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (h === undefined) return { iso: `${y}-${mo}-${d}T00:00:00Z`, allDay: true };
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`, allDay: false };
}

// unfold folded lines (iCal wraps long lines with a leading space) then split into events
function parseICS(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) return_continue: continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(";")[0]; // strip params like DTSTART;TZID=...
    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = value;
    else if (key === "LOCATION") cur.location = value;
    else if (key === "DTSTART") cur.start = parseICSDate(value);
    else if (key === "DTEND") cur.end = parseICSDate(value);
  }
  return events;
}

export default async function handler(req, res) {
  if (!ICS_URL || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }
  try {
    const icsRes = await fetch(ICS_URL);
    if (!icsRes.ok) return res.status(200).json({ ok: false, step: "fetch ics", status: icsRes.status });
    const text = await icsRes.text();

    const all = parseICS(text);

    // window: 14 days ago -> 60 days ahead
    const now = Date.now();
    const from = now - 14 * 864e5;
    const to = now + 60 * 864e5;

    const rows = all
      .filter(e => e.uid && e.start)
      .map(e => ({
        uid: e.uid,
        summary: e.summary || "(no title)",
        starts_at: e.start.iso,
        ends_at: e.end ? e.end.iso : e.start.iso,
        all_day: e.start.allDay,
        location: e.location || null,
        synced_at: new Date().toISOString(),
      }))
      .filter(r => {
        const t = new Date(r.starts_at).getTime();
        return t >= from && t <= to;
      });

    if (rows.length === 0) {
      return res.status(200).json({ ok: true, parsed: all.length, in_window: 0, note: "no events in window" });
    }

    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/calendar_events?on_conflict=uid`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!sRes.ok) return res.status(200).json({ ok: false, step: "supabase", status: sRes.status, body: (await sRes.text()).slice(0, 200) });

    return res.status(200).json({ ok: true, parsed: all.length, in_window: rows.length });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
