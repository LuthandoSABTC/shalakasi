// services/aiEngine.js
//
// Decides what a student should do next after a checkpoint:
// 'advance' | 'reinforce' | 'branch'.
//
// Two modes:
//  - If ANTHROPIC_API_KEY is set, asks Claude for a reasoned decision
//    given the student's mastery history (the "full adaptive AI" mode).
//  - Otherwise falls back to a simple, transparent rule so the app is
//    usable end-to-end before the AI key is wired up.
//
// Every decision is written to ai_decisions for admin review —
// see schema.sql. This is deliberate: the routing should never be
// a black box you can't audit with Sassa.

const supabase = require('./supabase');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MASTERY_THRESHOLD = 0.75;

async function decideNextStep({ studentId, sectionId, scorePercent, allSections, orderedIndex }) {
  const currentSection = allSections[orderedIndex];
  const nextSection = allSections[orderedIndex + 1] || null;

  let decision;

  if (ANTHROPIC_API_KEY) {
    decision = await askClaudeForDecision({ studentId, currentSection, nextSection, scorePercent, allSections });
  } else {
    decision = ruleBasedDecision({ scorePercent, currentSection, nextSection });
  }

  await supabase.from('ai_decisions').insert({
    student_id: studentId,
    from_section_id: currentSection.id,
    to_section_id: decision.toSectionId,
    decision_type: decision.type,
    reasoning: decision.reasoning,
  });

  return decision;
}

function ruleBasedDecision({ scorePercent, currentSection, nextSection }) {
  if (scorePercent >= MASTERY_THRESHOLD * 100) {
    return {
      type: 'advance',
      toSectionId: nextSection ? nextSection.id : null,
      reasoning: `Scored ${scorePercent}% on ${currentSection.number} (threshold ${MASTERY_THRESHOLD * 100}%) — moving ahead to ${nextSection ? nextSection.number : 'the next chapter'}.`,
    };
  }
  return {
    type: 'reinforce',
    toSectionId: currentSection.id,
    reasoning: `Scored ${scorePercent}% on ${currentSection.number}, below the ${MASTERY_THRESHOLD * 100}% mastery threshold — reviewing the same section before moving on.`,
  };
}

async function askClaudeForDecision({ studentId, currentSection, nextSection, scorePercent, allSections }) {
  // Pull recent history so Claude has real context, not just one score.
  const { data: recentAttempts } = await supabase
    .from('attempts')
    .select('is_correct, attempted_at')
    .eq('student_id', studentId)
    .order('attempted_at', { ascending: false })
    .limit(10);

  const { data: recentChat } = await supabase
    .from('chat_log')
    .select('role, message')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(6);

  const prompt = `You are ShalaKasi, the adaptive tutor inside the ShalaKasi platform, a self-paced Bitcoin Diploma for Bitcoin Ekasi in Mossel Bay.
A student just finished a checkpoint. Decide what should happen next.

Current section: ${currentSection.number} — ${currentSection.title}
Next section in sequence: ${nextSection ? `${nextSection.number} — ${nextSection.title}` : 'none (end of curriculum)'}
Checkpoint score: ${scorePercent}%
Recent quiz attempts (newest first, true=correct): ${JSON.stringify((recentAttempts || []).map(a => a.is_correct))}
Recent chat questions from this student: ${JSON.stringify((recentChat || []).filter(c => c.role === 'student').map(c => c.message))}

Respond ONLY with JSON, no other text, in this exact shape:
{"decision": "advance" | "reinforce" | "branch", "reasoning": "one or two plain sentences, written for the student's own dashboard"}

Rules: choose "reinforce" if the score is low or recent attempts show a pattern of struggle on this concept.
Choose "branch" only if the chat questions reveal a specific, different concept they're stuck on that should be addressed first.
Otherwise choose "advance".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const textBlock = (data.content || []).find((c) => c.type === 'text');
    const parsed = JSON.parse((textBlock?.text || '').replace(/```json|```/g, '').trim());

    const type = ['advance', 'reinforce', 'branch'].includes(parsed.decision) ? parsed.decision : 'advance';
    const toSectionId =
      type === 'advance' ? (nextSection ? nextSection.id : null) : currentSection.id;

    return { type, toSectionId, reasoning: parsed.reasoning || 'Moving to the next section.' };
  } catch (err) {
    console.error('[aiEngine] Claude call failed, falling back to rule-based decision:', err.message);
    return ruleBasedDecision({ scorePercent, currentSection, nextSection });
  }
}

// Simple chat reply — same fallback pattern as the routing decision above.
async function satoshiChatReply({ studentId, sectionId, sectionTitle, studentMessage }) {
  if (!ANTHROPIC_API_KEY) {
    return "ShalaKasi isn't fully wired up yet — set ANTHROPIC_API_KEY on the server to enable live chat. For now: keep going, you're doing fine!";
  }

  const { data: history } = await supabase
    .from('chat_log')
    .select('role, message')
    .eq('student_id', studentId)
    .eq('section_id', sectionId)
    .order('created_at', { ascending: true })
    .limit(10);

  const messages = [
    ...(history || []).map((h) => ({
      role: h.role === 'student' ? 'user' : 'assistant',
      content: h.message,
    })),
    { role: 'user', content: studentMessage },
  ];

  const systemPrompt = `You are ShalaKasi, the friendly AI mentor built into the Bitcoin Diploma at Bitcoin Ekasi (Mossel Bay). You're currently helping a student on section "${sectionTitle}". Keep answers short (2-4 sentences), encouraging, and grounded in the Bitcoin Diploma curriculum. If a question belongs to a later chapter, say so briefly and offer to flag it for when they get there instead of answering fully out of order.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    });
    const data = await response.json();
    const textBlock = (data.content || []).find((c) => c.type === 'text');
    return textBlock?.text || "Sorry, I didn't quite catch that — could you rephrase?";
  } catch (err) {
    console.error('[aiEngine] Chat call failed:', err.message);
    return "I'm having trouble connecting right now — try again in a moment.";
  }
}

module.exports = { decideNextStep, satoshiChatReply };
