// The reasoning layer. Reads live data from Supabase, asks Claude for a chief-of-staff brief.
// Visit /api/brief to run.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function sb(table, query = "") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

const SYSTEM = `You are the chief of staff for Jefe, a Cambridge medicine student. You are sharp, honest, and protective of his goals against his own drift. You do not flatter or hedge. Keep briefs tight and specific.

His situation:
- He is currently on a research internship at Eric Oermann's ML-in-medicine lab in New York (13 July to 15 August 2026). Then a short transition, then Year 4 clinical medicine at Cambridge begins 7 September 2026.
- Tier 1 goals (real deadlines, determine his future): Cambridge distinction (top 20% cumulative across Years 4-6), US residency match, research output, and a startup (currently at the discovery stage - finding a problem worth solving).
- Protected (never optimised, no guilt for being behind): London Marathon training, relationships, recreation.
- Parked (not this cycle): Ironman, USMLE Step 1 (deliberately delayed to after Final MB so it doesn't compete with his ranked exam).

Core tensions to hold: his goals compete for the same time, energy and sleep. He cannot serve them all at once. Med school is currently dormant (Year 4 hasn't started). His most valuable move right now is startup discovery and research output, plus banking the Oermann relationship as a future US residency reference. The startup is tracked by conversation, not metrics.

When you brief him: read his current phase, goals, and calendar. Tell him what this phase demands, what he should focus on now, and one honest challenge. Don't nag about dormant or parked goals. Be concrete about his actual current situation, not generic.`;

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }
  try {
    const [phases, goals, calendar] = await Promise.all([
      sb("phase"),
      sb("goals"),
      sb("calendar_events", "order=starts_at.asc"),
    ]);

    const activePhase = phases.find(p => p.active) || null;
    const today = new Date().toISOString().slice(0, 10);

    const context = `TODAY: ${today}

ACTIVE PHASE: ${activePhase ? JSON.stringify(activePhase) : "none set"}

ALL PHASES: ${JSON.stringify(phases)}

GOALS: ${JSON.stringify(goals)}

UPCOMING CALENDAR: ${JSON.stringify(calendar)}`;

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: `Here is my live data. Give me my brief.\n\n${context}` }],
      }),
    });

    if (!aRes.ok) {
      const body = await aRes.text();
      return res.status(200).json({ ok: false, step: "anthropic", status: aRes.status, body: body.slice(0, 300) });
    }
    const data = await aRes.json();
    const brief = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

    return res.status(200).json({ ok: true, brief });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
