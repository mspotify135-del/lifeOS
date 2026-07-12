// Syncs all seven Notion databases into Supabase.
// Visit /api/sync to run. Reports per-table so any failure is isolated.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// helpers to pull values out of Notion properties by type
function txt(p) {
  if (!p) return null;
  if (p.type === "title") return p.title.map(t => t.plain_text).join("") || null;
  if (p.type === "rich_text") return p.rich_text.map(t => t.plain_text).join("") || null;
  if (p.type === "select") return p.select ? p.select.name : null;
  if (p.type === "status") return p.status ? p.status.name : null;
  if (p.type === "date") return p.date ? p.date.start : null;
  if (p.type === "checkbox") return p.checkbox;
  if (p.type === "created_time") return p.created_time;
  return null;
}
function multi(p) {
  if (!p || p.type !== "multi_select") return [];
  return p.multi_select.map(o => o.name);
}

// each table: its Notion id, its Supabase table name, and how to map a row
const TABLES = [
  {
    name: "goals",
    db: "db471763-64a5-4955-b3a8-414630d01c4d",
    map: (p, id) => ({
      notion_id: id, goal: txt(p["Goal"]), tier: txt(p["Tier"]),
      domain: txt(p["Domain"]), current_objective: txt(p["Current objective"]),
      status: txt(p["Status"]), next_checkpoint: txt(p["Next checkpoint"]),
    }),
  },
  {
    name: "phase",
    db: "a46aee5c-c712-47b3-80f7-eab1b93d9bb6",
    map: (p, id) => ({
      notion_id: id, phase_name: txt(p["Phase name"]), type: txt(p["Type"]),
      start_date: txt(p["Start"]), end_date: txt(p["End"]),
      lead_priorities: txt(p["Lead priorities"]), dormant: txt(p["Dormant"]),
      active: txt(p["Active"]) === true,
    }),
  },
  {
    name: "observations",
    db: "c29a9955-c9e6-4e67-b51a-190791f272bd",
    map: (p, id) => ({
      notion_id: id, observation: txt(p["Observation"]), source: txt(p["Source"]),
      who_it_hurts: txt(p["Who it hurts"]), scale_hunch: txt(p["Scale hunch"]),
      status: txt(p["Status"]), observed_at: txt(p["Date"]),
    }),
  },
  {
    name: "encounters",
    db: "78140e14-1dba-4e4d-a075-f3b3d95d416b",
    map: (p, id) => ({
      notion_id: id, day: txt(p["Date"]), block: txt(p["Block"]),
      setting: txt(p["Setting"]), conditions_seen: multi(p["Conditions seen"]),
      stations_practised: multi(p["Stations practised"]),
      supervisor: txt(p["Supervisor"]), reflection: txt(p["Reflection"]),
    }),
  },
  {
    name: "gaps",
    db: "650a248e-e917-4520-b9cb-cf30bd0c92c7",
    map: (p, id) => ({
      notion_id: id, gap: txt(p["What I didn't know"]), condition: multi(p["Condition"]),
      source: txt(p["Source"]), status: txt(p["Status"]), opened_at: txt(p["Date opened"]),
    }),
  },
  {
    name: "requirements",
    db: "ecf40e06-8275-4557-bee9-2cba609fd0d3",
    map: (p, id) => ({
      notion_id: id, item: txt(p["Item"]), attached_to: txt(p["Attached to"]),
      window_closes: txt(p["Window closes"]), recoverable: txt(p["Recoverable"]) === true,
      status: txt(p["Status"]),
    }),
  },
  {
    name: "weekly",
    db: "b2e636e0-6e41-4b71-8b96-221d5e0f081b",
    map: (p, id) => ({
      notion_id: id, week_of: txt(p["Week of"]), phase: txt(p["Phase"]),
      qbank: txt(p["QBank percentile"]), sleep_rested: txt(p["Sleep and rested"]),
      training: txt(p["Training"]), research_moved: txt(p["Research moved"]),
      startup_update: txt(p["Startup update"]), relationships: txt(p["Relationships"]),
      recreation: txt(p["Recreation"]), last_week_priority_held: txt(p["Last week priority held"]),
    }),
  },
];

async function syncTable(t) {
  const nRes = await fetch(`https://api.notion.com/v1/databases/${t.db}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!nRes.ok) return { table: t.name, ok: false, step: "notion", status: nRes.status, body: (await nRes.text()).slice(0, 200) };
  const nData = await nRes.json();
  const rows = nData.results.map(pg => ({ ...t.map(pg.properties, pg.id), synced_at: new Date().toISOString() }));
  if (rows.length === 0) return { table: t.name, ok: true, synced: 0 };

  const sRes = await fetch(`${SUPABASE_URL}/rest/v1/${t.name}?on_conflict=notion_id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!sRes.ok) return { table: t.name, ok: false, step: "supabase", status: sRes.status, body: (await sRes.text()).slice(0, 200) };
  return { table: t.name, ok: true, synced: rows.length };
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }
  const results = [];
  for (const t of TABLES) {
    try { results.push(await syncTable(t)); }
    catch (e) { results.push({ table: t.name, ok: false, error: String(e) }); }
  }
  res.status(200).json({ ok: results.every(r => r.ok), results });
}
