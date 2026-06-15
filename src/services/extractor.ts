/**
 * Structure Extractor — the brain of Thought Plot.
 * Uses Gemini REST with forced JSON schema for reliable structured output.
 * Accepts existing graph context for incremental updates.
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { ExtractionResult, GraphJSON } from '../types';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

const EXTRACTION_PROMPT = `You are Thought Plot, an expert AI that extracts the SUBJECT MATTER of conversations into clean, professional diagrams.

CRITICAL RULE — DIAGRAM THE SUBJECT, NOT THE CONVERSATION:
You must diagram WHAT IS BEING DISCUSSED, not the act of discussing it.

WRONG approach (never do this):
- User says: "I want to build an AI app where AIs talk to other AIs"
- Bad output: nodes like "User speaks", "User says AI", "Conversation started", "User wants to build app"
- This is WRONG because it diagrams the conversation itself.

CORRECT approach (always do this):
- User says: "I want to build an AI app where AIs talk to other AIs"
- Good output: nodes like "AI App", "Agent 1", "Agent 2", "Message Broker", edges showing agents communicating
- This is CORRECT because it diagrams the SUBJECT the user is describing.

More examples of correct behavior:
- User discusses politics → diagram the political relationships, policies, cause/effects being discussed
- User describes a recipe → diagram the cooking steps, ingredients, timing
- User talks about their app idea → diagram the app architecture, components, data flow
- User explains a business plan → diagram the business model, revenue streams, customer segments
- User debates history → diagram the historical events, causes, people, timelines being discussed
- User brainstorms features → mindmap of the feature ideas and their relationships
- User describes system interactions → sequence diagram of the systems/APIs/services communicating

ASK YOURSELF: "What is the user TALKING ABOUT?" Then diagram THAT thing.

SELECTIVITY — PLOT WHAT MATTERS, SKIP THE REST:
- Identify the user's core INTENT or SUBJECT. Plot only what's central to that subject.
- SKIP: filler ("um", "like", "you know"), greetings, meta-commentary ("let me think about this"), tangents, repetition, small talk.
- If the user mentions 10 things but only 3-5 are central to their point, focus on THOSE. Summarize the rest or omit entirely.
- Combine closely related ideas into single nodes rather than creating one node per sentence.
- A 2-minute conversation should produce 5-12 nodes, NOT 20+. Quality over quantity.
- Ask yourself: "Would removing this node lose important structural meaning?" If no, skip it.
- Only create nodes for concepts that have meaningful RELATIONSHIPS to other concepts.
- Think like an expert summarizer: capture the STRUCTURE and KEY RELATIONSHIPS, not a transcript-to-diagram translation.

GRAPH TYPE SELECTION:
- "flowchart" (most common) — for processes, plans, architectures, dependencies, cause-effect, decision trees, system designs, step-by-step, any structural relationship
- "sequence" — ONLY when describing message passing, API calls, request/response patterns, or temporal interactions between named actors/systems. The actors must be distinct entities sending messages to each other.
- "mindmap" — ONLY for open brainstorming with no clear flow/dependencies, pure ideation and categorization

MERMAID BEST PRACTICES (follow these strictly):
1. Node IDs: lowercase, alphanumeric + underscore only, max 20 chars. Examples: "ai_agent", "msg_broker", "user_svc"
2. Node labels: concise, 2-6 words. Describe the concept, not the conversation. Examples: "Message Broker", "User Auth Service", "Tax Policy"
3. Edge labels: short verb phrases that describe the relationship. Examples: "sends request", "validates", "triggers", "depends on", "causes"
4. Use clusters/subgraphs to group related concepts. Example: a "Frontend" cluster and "Backend" cluster for an app architecture.
5. Prefer 5-20 nodes for clarity. More than 30 nodes becomes unreadable.
6. Every node MUST connect to at least one other node via an edge. No orphan nodes.
7. Use "decision" type nodes for branching logic or choices.
8. Use "system" type for services, APIs, databases, external systems.
9. Use "person" type for human actors, users, roles, stakeholders.
10. Use "idea" type for concepts, proposals, suggestions that are being explored.
11. Use "process" type for steps, actions, operations in a flow.
12. Use "fact" type for data points, statistics, established truths being referenced.
13. Use "assumption" type for unverified claims, hypotheses, opinions presented as fact.
14. Edge styles: "solid" for definite relationships, "dashed" for possible/conditional, "dotted" for weak/speculative.
15. For sequence diagrams: participants should be real actors (systems, people, services), not conversation meta-data.

NODE TYPE REFERENCE:
- process: steps, operations, actions in a flow
- decision: choices, conditions, branching points (rendered as diamonds)
- action: specific tasks someone needs to do (rendered as stadium shapes)
- fact: verified data points, statistics, established information
- assumption: claims that need verification, opinions stated as fact
- system: services, APIs, databases, platforms, tools, infrastructure
- person: human actors, users, roles, teams, organizations
- idea: concepts, proposals, brainstormed features, abstract concepts

FACT DETECTION (critical for fact-checking):
- ANY numerical claim (dates, percentages, counts, prices, measurements, stats) → MUST be in fact_checks with status "assumption"
- ANY "X was created/founded/invented/discovered by Y" → MUST be in fact_checks with status "assumption"
- ANY comparison claim ("X is bigger/faster/better/more than Y") → MUST be in fact_checks with status "assumption"
- ANY causal claim ("X causes Y", "because of X", "leads to") → MUST be in fact_checks with status "assumption"
- ANY historical claim → MUST be in fact_checks with status "assumption"
- "Everyone knows...", "It's well known that...", "Obviously..." → flag as assumption
- ANY claim about technology, science, geography, economics → MUST be in fact_checks with status "assumption"
- IMPORTANT: Default ALL factual claims to status "assumption" so they get verified. Only use "verified" if the claim is trivially obvious (e.g., "water is wet").
- If you KNOW something is wrong → set status "incorrect" with correction AND add to corrections array
- Be AGGRESSIVE about flagging claims. It is better to flag too many than too few.

ACTION ITEMS:
- Explicit tasks: "We need to...", "Someone should...", "Action item:...", "Let's...", "TODO:" → action_items
- Include owner if mentioned, deadline if mentioned

CORRECTIONS:
- Only for claims you are CERTAIN are factually wrong
- The correction field should be a clear, brief statement of what is actually true
`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    graph: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ['flowchart', 'sequence', 'mindmap'] },
        title: { type: Type.STRING },
        nodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['process', 'decision', 'action', 'fact', 'assumption', 'system', 'person', 'idea'] },
              status: { type: Type.STRING, enum: ['verified', 'incorrect', 'assumption', 'pending'] },
              owner: { type: Type.STRING },
              deadline: { type: Type.STRING },
              cluster: { type: Type.STRING },
            },
            required: ['id', 'label', 'type'],
          },
        },
        edges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              from: { type: Type.STRING },
              to: { type: Type.STRING },
              label: { type: Type.STRING },
              style: { type: Type.STRING, enum: ['solid', 'dashed', 'dotted'] },
            },
            required: ['from', 'to'],
          },
        },
        clusters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              label: { type: Type.STRING },
              nodeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'label', 'nodeIds'],
          },
        },
      },
      required: ['type', 'nodes', 'edges'],
    },
    summary: { type: Type.STRING },
    action_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          owner: { type: Type.STRING },
          deadline: { type: Type.STRING },
        },
        required: ['text'],
      },
    },
    fact_checks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          claim: { type: Type.STRING },
          status: { type: Type.STRING, enum: ['verified', 'incorrect', 'assumption'] },
          correction: { type: Type.STRING },
        },
        required: ['claim', 'status'],
      },
    },
    corrections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          statement: { type: Type.STRING },
          correction: { type: Type.STRING },
        },
        required: ['statement', 'correction'],
      },
    },
  },
  required: ['graph', 'summary', 'action_items', 'fact_checks', 'corrections'],
};

let genAI: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genAI) {
    if (!API_KEY) throw new Error('Gemini API key not configured');
    genAI = new GoogleGenAI({ apiKey: API_KEY });
  }
  return genAI;
}

function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 25) || 'node';
}

/**
 * Extract structure. Accepts existing graph + claims for incremental building.
 */
export async function extractStructure(
  transcript: string,
  existingClaims?: string[],
  existingGraph?: GraphJSON
): Promise<ExtractionResult | null> {
  if (!transcript.trim()) return null;

  let prompt = EXTRACTION_PROMPT;

  // Provide existing graph context so AI adds to it
  if (existingGraph && existingGraph.nodes.length > 0) {
    prompt += '\n\nEXISTING GRAPH (build upon this, keep existing nodes, add new ones for new information):\n';
    prompt += 'Current graph type: ' + existingGraph.type + '\n';
    if (existingGraph.title) prompt += 'Title: ' + existingGraph.title + '\n';
    prompt += 'Nodes:\n' + existingGraph.nodes.map(n =>
      `- ${n.id}: "${n.label}" (type: ${n.type}${n.status ? ', status: ' + n.status : ''})`
    ).join('\n');
    prompt += '\nEdges:\n' + existingGraph.edges.map(e =>
      `- ${e.from} -> ${e.to}${e.label ? ' ("' + e.label + '")' : ''}`
    ).join('\n');
    if (existingGraph.clusters && existingGraph.clusters.length > 0) {
      prompt += '\nClusters:\n' + existingGraph.clusters.map(c =>
        `- ${c.id}: "${c.label}" contains [${c.nodeIds.join(', ')}]`
      ).join('\n');
    }
    prompt += '\n\nPreserve existing node IDs. Add new nodes for new information. You may update labels/statuses of existing nodes. Keep the same graph type unless the conversation dramatically shifts to need a different one.';
  }

  // Tell AI about already-known claims to avoid repetition
  if (existingClaims && existingClaims.length > 0) {
    prompt += '\n\nALREADY IDENTIFIED CLAIMS (do NOT repeat these in fact_checks):\n';
    prompt += existingClaims.map(c => `- ${c}`).join('\n');
  }

  prompt += '\n\nTRANSCRIPT TO ANALYZE:\n' + transcript;
  prompt += '\n\nRemember: Diagram the SUBJECT MATTER being discussed, NOT the conversation itself. What are they TALKING ABOUT? Diagram THAT.';

  try {
    const client = getClient();
    const result = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const text = result.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as ExtractionResult;
    if (!parsed.graph || !Array.isArray(parsed.graph.nodes)) return null;

    // Sanitize IDs
    parsed.graph.nodes = parsed.graph.nodes.map(n => ({ ...n, id: sanitizeId(n.id) }));
    parsed.graph.edges = parsed.graph.edges.map(e => ({
      ...e, from: sanitizeId(e.from), to: sanitizeId(e.to),
    }));
    if (parsed.graph.clusters) {
      parsed.graph.clusters = parsed.graph.clusters.map(c => ({
        ...c, id: sanitizeId(c.id), nodeIds: c.nodeIds.map(sanitizeId),
      }));
    }

    // Filter invalid edges
    const nodeIds = new Set(parsed.graph.nodes.map(n => n.id));
    parsed.graph.edges = parsed.graph.edges.filter(
      e => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to
    );

    return parsed;
  } catch (err) {
    console.error('Extraction failed:', err);
    return null;
  }
}
