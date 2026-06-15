/**
 * Fact Checker — fast batch verification using Gemini's training knowledge.
 * No external search dependency — single API call for all claims.
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { FactCheck } from '../types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
let genAI: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genAI) genAI = new GoogleGenAI({ apiKey: API_KEY });
  return genAI;
}

export type FactCheckCallback = (result: FactCheck) => void;

const BATCH_VERIFY_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      index: { type: Type.NUMBER },
      status: { type: Type.STRING, enum: ['verified', 'incorrect', 'assumption'] },
      correction: { type: Type.STRING },
      confidence: { type: Type.NUMBER },
    },
    required: ['index', 'status', 'confidence'],
  },
};

/**
 * Verify a single claim (fallback for when batch fails).
 */
export async function verifyClaim(
  claim: string,
  onResult: FactCheckCallback
): Promise<void> {
  const id = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  onResult({ id, claim, status: 'checking', timestamp: Date.now() });

  if (!API_KEY) {
    onResult({ id, claim, status: 'assumption', timestamp: Date.now() });
    return;
  }

  try {
    const client = getClient();
    const result = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a rigorous fact checker. Determine if this claim is true, false, or unverifiable using your knowledge.

CLAIM: "${claim}"

RULES:
- "verified" = You are confident this is factually correct. Confidence 0.7-1.0.
- "incorrect" = You are confident this is factually wrong. You MUST provide the correct information in "correction". Confidence 0.7-1.0.
- "assumption" = Not enough certainty, subjective, or opinion-based. Confidence 0.3-0.6.

IMPORTANT: Only mark "incorrect" if you are CERTAIN. When in doubt, use "assumption".
Do NOT mark opinions or subjective statements as "incorrect" — those are "assumption".

Respond ONLY with valid JSON:
{"status": "verified", "correction": "", "confidence": 0.85}`,
        }],
      }],
    });

    const text = result.text?.trim() || '';
    const m = text.match(/\{[\s\S]*?\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (['verified', 'incorrect', 'assumption'].includes(parsed.status)) {
        onResult({
          id, claim,
          status: parsed.status,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
          correction: parsed.correction || undefined,
          timestamp: Date.now(),
        });
        return;
      }
    }
  } catch (err) {
    console.warn('Single claim verification failed:', err);
  }

  onResult({ id, claim, status: 'assumption', timestamp: Date.now() });
}

/**
 * Batch verify ALL claims in a single Gemini call.
 * Falls back to individual verification if batch fails.
 */
export async function verifyClaimsBatch(
  claims: { claim: string; status: string }[],
  onResult: FactCheckCallback
): Promise<void> {
  const toVerify = claims.filter(c => c.status === 'assumption' || c.status === 'verified');
  if (toVerify.length === 0) return;

  // Emit "checking" status for all claims
  const ids = toVerify.map((c) => {
    const id = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onResult({ id, claim: c.claim, status: 'checking', timestamp: Date.now() });
    return id;
  });

  if (!API_KEY) {
    toVerify.forEach((c, i) => {
      onResult({ id: ids[i], claim: c.claim, status: 'assumption', timestamp: Date.now() });
    });
    return;
  }

  try {
    const client = getClient();
    const claimsList = toVerify.map((c, i) => `${i}. "${c.claim}"`).join('\n');

    const result = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a rigorous fact checker. Verify each claim below using your training knowledge.

CLAIMS:
${claimsList}

FOR EACH CLAIM, determine:
- "verified" = Factually correct with high confidence (0.7-1.0)
- "incorrect" = Factually wrong with high confidence (0.7-1.0). MUST provide "correction" with the correct fact.
- "assumption" = Uncertain, subjective, or opinion-based (0.3-0.6)

RULES:
- Only mark "incorrect" if you are CERTAIN the claim is factually wrong.
- Do NOT mark opinions, preferences, or subjective statements as "incorrect" — use "assumption".
- For "incorrect" claims, the "correction" must be a brief, precise statement of the actual fact.
- Numbers approximately correct (within 10%) can be "verified".

Return a JSON array with one entry per claim, using the claim's index number.`,
        }],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: BATCH_VERIFY_SCHEMA,
      },
    });

    const text = result.text?.trim();
    if (text) {
      const parsed = JSON.parse(text) as Array<{
        index: number;
        status: 'verified' | 'incorrect' | 'assumption';
        correction?: string;
        confidence: number;
      }>;

      for (const entry of parsed) {
        const idx = entry.index;
        if (idx >= 0 && idx < toVerify.length) {
          onResult({
            id: ids[idx],
            claim: toVerify[idx].claim,
            status: entry.status,
            confidence: entry.confidence,
            correction: entry.correction || undefined,
            timestamp: Date.now(),
          });
        }
      }

      // Any claims not in the response get marked as assumption
      const responded = new Set(parsed.map(e => e.index));
      toVerify.forEach((c, i) => {
        if (!responded.has(i)) {
          onResult({ id: ids[i], claim: c.claim, status: 'assumption', timestamp: Date.now() });
        }
      });
      return;
    }
  } catch (err) {
    console.warn('Batch verification failed, falling back to individual:', err);
  }

  // Fallback: verify individually (in parallel batches of 3)
  for (let i = 0; i < toVerify.length; i += 3) {
    const batch = toVerify.slice(i, i + 3);
    await Promise.allSettled(batch.map(c => verifyClaim(c.claim, onResult)));
  }
}
