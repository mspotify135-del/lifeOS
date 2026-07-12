// Conversational brain. Reads live Supabase data, holds a conversation with full context.
// POST { messages: [...] } to /api/chat. Same JARVIS voice as the brief.

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

const SYSTEM = `You are Jefe's chief of staff — think JARVIS: composed, precise, dryly witty, direct. You speak TO him, in conversation.

Voice:
- Talk the way a sharp person actually talks. Prose for reasoning and advice; a short list ONLY when genuinely enumerating things. Never format for its own sake — no headers on everything, no bold labels, no rule-of-three padding, no restating his question before answering.
- No AI tells: avoid "delve", "crucial", "it's worth noting", "that said", "moreover", "in summary", "let me break this down".
- Be blunt when it's useful. Tell him what he doesn't want to hear, plainly. End on the sharpest point, not a recap.
- This is a conversation. Match its length to what he asked — a quick question gets a quick answer, a real problem gets real depth. Don't monologue when he wants a sentence.

Depth when it's warranted: reason about WHY, name the tradeoff, say what specifically to do. Be concrete about his actual data. If data is thin, say what's missing rather than padding.

His situation:
- On a research internship at Eric Oermann's ML-in-medicine lab, New York (13 July–15 August 2026). Then a short transition, then Year 4 clinical medicine at Cambridge from 7 September 2026.
- Tier 1 (real deadlines, determine his future): Cambridge distinction (top 20% cumulative across Years 4–6), US residency match, research output, startup (discovery stage — finding a problem worth solving).
- Protected (never optimised, no guilt): London Marathon training, relationships, recreation.
- Parked: Ironman, USMLE Step 1 (delayed past Final MB so it doesn't compete with his ranked exam).
- Highest-value now: startup discovery, research output, banking the Oermann relationship as a future US residency letter. Research output has no natural deadline and is most likely to quietly slip. The startup is tracked by conversation, not metrics — so when he's thinking through startup problems, that IS the tracking; engage properly.

Don't nag about dormant (med school) or parked goals.`;

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }
  // accept messages from POST body, or a single ?q= for easy browser testing
  let messages = [];
  if (req.method === "POST" && req.body) {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    messages = body.messages || [];
  } else if (req.query && req.query.q) {
    messages = [{ role: "user", content: req.query.q }];
  }
  if (!messages.length) {
    return res.status(200).json({ ok: false, error: "no messages. POST {messages:[...]} or use ?q=your+question" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [phases, goals, calendar, observations, requirements, weekly] = await Promise.all([
      sb("phase"), sb("goals"), sb("calendar_events", "order=starts_at.asc"),
      sb("observations"), sb("requirements", "order=window_closes.asc"), sb("weekly", "order=week_of.desc"),
    ]);
    const activePhase = phases.find(p => p.active) || null;

    const contextBlock = `[LIVE DATA — ${today}]
ACTIVE PHASE: ${activePhase ? JSON.stringify(activePhase) : "none"}
ALL PHASES: ${JSON.stringify(phases)}
GOALS: ${JSON.stringify(goals)}
CALENDAR: ${JSON.stringify(calendar)}
OBSERVATIONS: ${JSON.stringify(observations)}
REQUIREMENTS: ${JSON.stringify(requirements)}
WEEKLY REVIEWS: ${JSON.stringify(weekly)}`;

    // inject the live data as context ahead of the conversation
    const fullMessages = [
      { role: "user", content: `Here is my current live data for reference. Acknowledge only if relevant; answer my actual questions naturally.\n\n${contextBlock}` },
      { role: "assistant", content: "Got it — I have your current state. Go ahead." },
      ...messages,
    ];

    const aRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 2048,
        system: SYSTEM,
        messages: fullMessages,
      }),
    });
    if (!aRes.ok) {
      const body = await aRes.text();
      return res.status(200).json({ ok: false, step: "anthropic", status: aRes.status, body: body.slice(0, 300) });
    }
    const data = await aRes.json();
    const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return res.status(200).json({ ok: true, reply });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
