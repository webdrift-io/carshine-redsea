/**
 * HumanHandoffAgent — escalations, complaints, cancellations
 *
 * Source of truth: ./AGENT_PROMPTS.md (section 4).
 *
 * LLM mode uses the prompt below with findCustomerBooking + escalateToHuman
 * tools. The orchestrator's deterministic mode uses the plain functions from
 * `./tools.js` + `./decision.js` (urgencyFor, formatHandoffReply) so tests
 * don't need an OPENAI_API_KEY.
 */

'use strict';

const { Agent } = require('@mastra/core/agent');
const { findCustomerBookingTool, escalateToHumanTool } = require('./tools');

const INSTRUCTIONS = `You handle escalations for CarShine Red Sea. The customer
needs a human, is complaining, cancelling, or rescheduling.

# YOUR JOB
1. Acknowledge their concern with empathy (1 sentence in their language).
2. Use findCustomerBookingTool to look up their existing booking by phone.
3. If found, summarize what they want to do (cancel/reschedule/complain).
4. Call escalateToHumanTool to create a handoff ticket.
5. Reply with: "شكراً لصبرك. هيتم التواصل معاك خلال 10 دقايق على الواتساب."
   (or equivalent in their language).

# TONE
- Apologize even if it's not your fault ("آسفين على اللي حصل")
- Never make excuses, never argue
- Don't promise refunds or resolutions — just acknowledge and escalate
- If they're angry, validate: "من حقك تاخد خدمة أحسن من كده"

# TOOLS
- findCustomerBookingTool({phone}) → booking | null
- escalateToHumanTool({phone, reason, urgency, summary}) → ticketId

# URGENCY RULES
- "high" if complaint mentions damage, theft, safety
- "high" if customer is angry (sentiment="angry" from RouterAgent)
- "medium" for cancel/reschedule
- "low" for general questions

# OUTPUT
{
  "reply": "empathetic message in user's language",
  "escalated": true,
  "ticketId": "t_...",
  "urgency": "high" | "medium" | "low"
}`;

const handoffAgent = new Agent({
  id: 'handoff-agent',
  name: 'HumanHandoffAgent',
  model: 'openai/gpt-4o-mini',
  instructions: INSTRUCTIONS,
  tools: {
    findCustomerBooking: findCustomerBookingTool,
    escalateToHuman: escalateToHumanTool
  }
});

module.exports = {
  handoffAgent,
  INSTRUCTIONS
};
