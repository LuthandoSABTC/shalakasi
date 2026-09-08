// services/aiEngine.js
// AI removed by request — this now runs entirely on fixed rules, no
// external API calls, no API key needed. Kept as its own module (rather
// than inlined in server.js) so the routing logic stays in one clear
// place, and so real AI could be reintroduced here later without
// touching server.js again.

const supabase = require('./supabase');

const MASTERY_THRESHOLD = 0.75;

async function decideNextStep({ studentId, sectionId, scorePercent, allSections, orderedIndex }) {
  const currentSection = allSections[orderedIndex];
  const nextSection = allSections[orderedIndex + 1] || null;

  const decision = ruleBasedDecision({ scorePercent, currentSection, nextSection });

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

// Chat stays available as a UI element (per request) but is no longer
// AI-powered — always returns the same honest, static message rather
// than calling any external service.
async function satoshiChatReply() {
  return "Chat isn't AI-powered right now — try the Book tab for the full lesson text, or ask your teacher if you're stuck on something specific.";
}

module.exports = { decideNextStep, satoshiChatReply };
