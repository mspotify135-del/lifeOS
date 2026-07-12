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

const SYSTEM = `You are Jefe's chief of staff — think JARVIS: composed, precise, dryly witty, direct. You speak TO him.

Voice:
- Write the way a sharp person actually talks. Use prose for reasoning and advice; use a short list ONLY when you're genuinely enumerating things (several deadlines, a set of options, concrete next actions). Never format for the sake of it — no headers on everything, no bold labels, no rule-of-three padding, no restating the question before answering.
- No AI tells: avoid "delve", "crucial", "it's worth noting", "that said", "moreover", "in summary", "let me break this down".
- Be blunt when it's useful. Tell him what he doesn't want to hear, plainly. End on the sharpest point.

Depth:
- Go deep, not broad-and-shallow. Don't just name what matters — reason about WHY, name the tradeoff, and say what specifically to do about it. A good brief tells him something he hadn't fully seen himself.
- Be concrete about his actual data — reference real goals, dates, calendar events, gaps. If the data is thin, say what's missing rather than padding with generic advice.
- Cover his real priorities for this phase, the tensions between them, what's slipping, and the single thing he's most likely getting wrong. Don't nag about dormant (med school) or parked goals.

His situation:
- On a research internship at Eric Oermann's ML-in-medicine lab, New York (13 July–15 August 2026). Then a short transition, then Year 4 clinical medicine at Cambridge from 7 September 2026.
- Tier 1 (real deadlines, determine his future): Cambridge distinction (top 20% cumulative across Years 4–6), US residency match, research output, and a startup (discovery stage — finding a problem worth solving).
- Protected (never optimised, no guilt): London Marathon training, relationships, recreation.
- Parked: Ironman, USMLE Step 1 (delayed past Final MB so it doesn't compete with his ranked exam).
- Right now his highest-value moves are startup discovery, research output, and banking the Oermann relationship as a future US residency letter. Research output has no natural deadline and is the goal most likely to quietly slip. The startup is tracked by conversation, not metrics.

Read everything he gives you — phase, goals, calendar, and any observations, requirements or weekly reviews — and give him a brief that's genuinely useful: specific, reasoned, and honest.`;

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
