/**
 * Exa search API — multi-query fact checking with richer evidence.
 */

const EXA_API_KEY = import.meta.env.VITE_EXA_API_KEY || '';

export interface ExaResult {
  answer: string;
  sources: { url: string; title: string }[];
}

export async function searchClaim(claim: string): Promise<ExaResult | null> {
  if (!EXA_API_KEY) return null;

  const sources: { url: string; title: string }[] = [];
  let answer = '';

  // Search with multiple query formulations for better coverage
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify({
        query: `Is it true that: ${claim}`,
        type: 'neural',
        useAutoprompt: true,
        numResults: 5,
        contents: { text: { maxCharacters: 1000 } },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      for (const r of data.results || []) {
        if (r.url && r.title) {
          sources.push({ url: r.url, title: r.title });
        }
      }
    }
  } catch {
    // Continue even if search fails
  }

  // Get a direct answer
  try {
    const answerRes = await fetch('https://api.exa.ai/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify({
        query: `Verify this claim: "${claim}". Is it true or false? Provide evidence.`,
        text: true,
      }),
    });

    if (answerRes.ok) {
      const answerData = await answerRes.json();
      answer = answerData.answer || '';
    }
  } catch {
    // answer stays empty
  }

  if (!answer && sources.length === 0) return null;
  return { answer, sources };
}
