// Syncs the Goals database from Notion into Supabase.
// Run by visiting /api/sync in the browser. Proves the pipe before we add the other six.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const GOALS_DB = "db471763-64a5-4955-b3a8-414630d01c4d";

// pull plain text out of a Notion property, whatever its type
function txt(prop) {
  if (!prop) return null;
  if (prop.type === "title") return prop.title.map(t => t.plain_text).join("") || null;
  if (prop.type === "rich_text") return prop.rich_text.map(t => t.plain_text).join("") || null;
  if (prop.type === "select") return prop.select ? prop.select.name : null;
  if (prop.type === "status") return prop.status ? prop.status.name : null;
  if (prop.type === "date") return prop.date ? prop.date.start : null;
  return null;
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }

  try {
    // 1. read all rows from the Notion Goals database
    const nRes = await fetch(`https://api.notion.com/v1/databases/${GOALS_DB}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!nRes.ok) {
      const body = await nRes.text();
      return res.status(200).json({ ok: false, step: "notion read", status: nRes.status, body: body.slice(0, 300) });
    }
    const nData = await nRes.json();

    // 2. reshape each Notion row into a Supabase row
    const rows = nData.results.map(page => {
      const p = page.properties;
      return {
        notion_id: page.id,
        goal: txt(p["Goal"]),
        tier: txt(p["Tier"]),
        domain: txt(p["Domain"]),
        current_objective: txt(p["Current objective"]),
        status: txt(p["Status"]),
        next_checkpoint: txt(p["Next checkpoint"]),
        synced_at: new Date().toISOString(),
      };
    });

    // 3. upsert into Supabase (insert new, update existing, matched on notion_id)
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/goals?on_conflict=notion_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!sRes.ok) {
      const body = await sRes.text();
      return res.status(200).json({ ok: false, step: "supabase write", status: sRes.status, body: body.slice(0, 300) });
    }

    return res.status(200).json({ ok: true, synced: rows.length });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
