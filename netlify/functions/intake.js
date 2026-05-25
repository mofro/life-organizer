// Conversation Intake Agent — extracts tasks, commitments, and decisions from conversational text.
//
// POST /.netlify/functions/intake
//   Body: { text: string, source?: string, context?: string, project?: string }
//   Response: { extractions: Extraction[], truncated: boolean }
//
// Extraction shape per item:
//   { type, title, content: { description?, deadline?, priority?, owner? },
//     destination, thirdParty, confidence, sourceSpan }
//
// Env vars required:
//   ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk';

const MAX_CHARS = 100_000; // ~25k tokens — conservative for a single haiku extraction call

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SYSTEM_PROMPT = `You are a precision task extractor. Extract only concrete, actionable items from the given conversational text.

Return a JSON array. Each item must have:
- type: "TASK" | "COMMITMENT" | "DECISION" | "QUESTION" | "EVENT"
- title: string (short imperative phrase for TASK/COMMITMENT; declarative for DECISION; question text for QUESTION)
- content: object with optional fields:
  - description: string (only if additional context beyond the title is needed)
  - deadline: string (natural language, e.g. "Friday", "Wednesday" — only if explicitly mentioned)
  - priority: integer 0-4 (0=critical, 1=high, 2=medium, 3=low, 4=backlog — only if stated or clearly implied)
  - owner: string (person's name — only if someone other than the speaker is responsible)
- destination: "beads" (software/technical work) | "personal-task" (personal errands, appointments, non-technical)
- thirdParty: boolean (true when a named person other than the speaker is the doer, e.g. "Sarah will handle X")
- confidence: float 0.0–1.0
  - ≥0.80: clearly stated, concrete, unambiguous
  - 0.50–0.79: hedged, inferred, or somewhat uncertain
  - <0.50: speculative or vague
- sourceSpan: exact quote from the input that this extraction came from

Rules:
- QUESTION type items are never auto-created regardless of confidence
- thirdParty=true forces human review even at high confidence
- Do not invent items not present in the text
- Return ONLY the JSON array, no explanation or surrounding text`;

export default async (req) => {
  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) return json({ error: 'Missing configuration' }, 500);
  if (req.method?.toUpperCase() !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const { text, source = 'form', context = 'mixed', project } = body;
  if (!text?.trim()) return json({ error: 'text is required' }, 400);

  const truncated = text.length > MAX_CHARS;
  const inputText = truncated ? text.slice(0, MAX_CHARS) : text;

  const userParts = [
    `Source: ${source}`,
    context !== 'mixed' ? `Context: ${context}` : null,
    project ? `Project: ${project}` : null,
    '',
    'Text to analyse:',
    '---',
    inputText,
    truncated ? '\n[... conversation truncated for length ...]' : null,
  ].filter(Boolean).join('\n');

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userParts }],
    });

    const raw = msg.content[0]?.text ?? '[]';
    let extractions;
    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      extractions = JSON.parse(cleaned);
      if (!Array.isArray(extractions)) extractions = [];
    } catch {
      extractions = [];
    }

    return json({ extractions, truncated });
  } catch (e) {
    console.error('[intake] Claude call failed:', e.message);
    return json({ error: 'Extraction failed — please try again' }, 500);
  }
};
