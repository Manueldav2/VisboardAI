/**
 * Graph Engine — converts GraphJSON → beautiful Mermaid syntax.
 *
 * Features:
 * - Colorblind-friendly palette on dark backgrounds
 * - Per-node-type shapes and colors
 * - Status-based visual styling (verified/incorrect/assumption)
 * - Conversation color coding via subgraphs
 * - Edge coloring with linkStyle
 * - Auto-direction heuristic (TD vs LR)
 * - Incremental graph merging
 */

import type { GraphJSON, GraphNode, GraphEdge, ConversationSegment } from '../types';

// ── Color Palette (colorblind-friendly, dark-bg optimized) ──

const PALETTE = {
  blue:   { fill: '#1f2a30', stroke: '#8ab5cc', text: '#c0dae8' },
  green:  { fill: '#1f2d24', stroke: '#7dbf8e', text: '#b8dcc2' },
  red:    { fill: '#302220', stroke: '#cf8075', text: '#e8bab4' },
  yellow: { fill: '#302a1e', stroke: '#d4b07a', text: '#e8d6b0' },
  teal:   { fill: '#1e2d2a', stroke: '#7ecdb8', text: '#b4e4d6' },
  purple: { fill: '#28202e', stroke: '#b79bc4', text: '#d8c4e2' },
  nude:   { fill: '#2a2219', stroke: '#c9a282', text: '#e0ccb8' },
};

export const CONVERSATION_COLORS = [
  PALETTE.blue, PALETTE.teal, PALETTE.purple,
  PALETTE.nude, PALETTE.green, PALETTE.yellow,
];

// ── Sanitize label ──

// Mermaid reserved words that can't be used as node IDs
const MERMAID_RESERVED = new Set([
  'end', 'graph', 'subgraph', 'flowchart', 'sequencediagram', 'mindmap',
  'click', 'style', 'classDef', 'class', 'linkStyle', 'direction',
  'participant', 'note', 'loop', 'alt', 'opt', 'par', 'rect', 'activate', 'deactivate',
]);

function san(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/[[\]{}()<>|#&;\\`~^]/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim()
    .slice(0, 55) || 'node';
}

function safeId(id: string): string {
  let safe = id.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 25) || 'n';
  // Prefix if it starts with a digit or is a reserved word
  if (/^\d/.test(safe) || MERMAID_RESERVED.has(safe)) {
    safe = 'n_' + safe;
  }
  return safe;
}

// ── Node shapes by type ──

function renderNode(node: GraphNode, simple = false): string {
  const label = san(node.label);
  const id = safeId(node.id);
  let suffix = '';
  if (node.owner) suffix += ` @${san(node.owner)}`;
  const full = suffix ? `${label}${suffix}` : label;

  // Simple mode: only use basic rectangle shapes (guaranteed safe syntax)
  if (simple) {
    return `  ${id}["${full}"]`;
  }

  switch (node.type) {
    case 'decision':    return `  ${id}{"${full}"}`;
    case 'action':      return `  ${id}(["${full}"])`;
    case 'fact':        return `  ${id}["${full}"]`;       // rectangle (parallelogram can break)
    case 'assumption':  return `  ${id}(("${full}"))`;
    case 'system':      return `  ${id}[["${full}"]]`;
    case 'person':      return `  ${id}(["${full}"])`;     // stadium (flag shape breaks often)
    case 'idea':        return `  ${id}("${full}")`;       // rounded rect (asymmetric shape breaks)
    case 'process':
    default:            return `  ${id}["${full}"]`;
  }
}

// ── Edge rendering ──

function renderEdge(edge: GraphEdge): string {
  const from = safeId(edge.from);
  const to = safeId(edge.to);
  const label = edge.label ? san(edge.label) : '';
  if (edge.style === 'dashed') {
    return label ? `  ${from} -. "${label}" .-> ${to}` : `  ${from} -.-> ${to}`;
  }
  if (edge.style === 'dotted') {
    return label ? `  ${from} -. "${label}" .-> ${to}` : `  ${from} -.-> ${to}`;
  }
  return label ? `  ${from} -->|"${label}"| ${to}` : `  ${from} --> ${to}`;
}

// ── Auto-direction heuristic ──

function chooseDirection(graph: GraphJSON): string {
  const inDeg = new Map<string, number>();
  graph.nodes.forEach(n => inDeg.set(n.id, 0));
  graph.edges.forEach(e => { const c = inDeg.get(e.to) || 0; inDeg.set(e.to, c + 1); });
  const roots = [...inDeg.values()].filter(d => d === 0).length;
  return roots > 4 ? 'LR' : 'TD';
}

// ── Flowchart Renderer ──

function renderFlowchart(graph: GraphJSON, conversations?: ConversationSegment[]): string {
  const dir = chooseDirection(graph);
  const lines: string[] = [`flowchart ${dir}`];

  // ── Class definitions ──

  // Status classes
  lines.push(`  classDef verified fill:${PALETTE.green.fill},stroke:${PALETTE.green.stroke},stroke-width:3px,color:${PALETTE.green.text}`);
  lines.push(`  classDef incorrect fill:${PALETTE.red.fill},stroke:${PALETTE.red.stroke},stroke-width:3px,color:${PALETTE.red.text},stroke-dasharray:5 5`);
  lines.push(`  classDef assumption fill:${PALETTE.yellow.fill},stroke:${PALETTE.yellow.stroke},stroke-width:2px,color:${PALETTE.yellow.text},stroke-dasharray:3 3`);

  // Type classes
  lines.push(`  classDef actionNode fill:${PALETTE.blue.fill},stroke:${PALETTE.blue.stroke},stroke-width:2px,color:${PALETTE.blue.text}`);
  lines.push(`  classDef personNode fill:${PALETTE.purple.fill},stroke:${PALETTE.purple.stroke},stroke-width:2px,color:${PALETTE.purple.text}`);
  lines.push(`  classDef systemNode fill:${PALETTE.teal.fill},stroke:${PALETTE.teal.stroke},stroke-width:2px,color:${PALETTE.teal.text}`);
  lines.push(`  classDef ideaNode fill:${PALETTE.nude.fill},stroke:${PALETTE.nude.stroke},stroke-width:2px,color:${PALETTE.nude.text}`);
  lines.push(`  classDef factNode fill:${PALETTE.green.fill},stroke:${PALETTE.green.stroke},stroke-width:1px,color:${PALETTE.green.text}`);
  lines.push(`  classDef processNode fill:#2a2219,stroke:#9c8b78,stroke-width:1px,color:#d4c4b0`);
  lines.push(`  classDef decisionNode fill:${PALETTE.yellow.fill},stroke:${PALETTE.yellow.stroke},stroke-width:2px,color:${PALETTE.yellow.text}`);

  // Conversation-specific classes
  if (conversations) {
    conversations.forEach((conv, i) => {
      const c = CONVERSATION_COLORS[i % CONVERSATION_COLORS.length];
      lines.push(`  classDef conv_${conv.id} fill:${c.fill},stroke:${c.stroke},stroke-width:2px,color:${c.text}`);
    });
  }

  lines.push('');

  // ── Nodes in subgraphs (conversations or clusters) ──

  const renderedNodes = new Set<string>();

  // Conversation subgraphs
  if (conversations && conversations.length > 1) {
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const convNodes = graph.nodes.filter(n => n.conversationId === conv.id);
      if (convNodes.length === 0) continue;
      const c = CONVERSATION_COLORS[i % CONVERSATION_COLORS.length];
      lines.push(`  subgraph ${conv.id}["${san(conv.label)}"]`);
      lines.push(`    style ${conv.id} fill:#1a1510,stroke:${c.stroke},stroke-width:2px,color:${c.text},stroke-dasharray:0`);
      for (const node of convNodes) {
        lines.push(`  ${renderNode(node)}`);
        renderedNodes.add(node.id);
      }
      lines.push('  end');
      lines.push('');
    }
  }

  // Cluster subgraphs
  if (graph.clusters) {
    for (const cluster of graph.clusters) {
      const clusterNodes = cluster.nodeIds
        .map(id => graph.nodes.find(n => n.id === id))
        .filter((n): n is GraphNode => !!n && !renderedNodes.has(n.id));
      if (clusterNodes.length === 0) continue;
      lines.push(`  subgraph ${cluster.id}["${san(cluster.label)}"]`);
      lines.push(`    style ${cluster.id} fill:#1a1510,stroke:#4d3f33,stroke-width:1px,color:#9c8b78`);
      for (const node of clusterNodes) {
        lines.push(`  ${renderNode(node)}`);
        renderedNodes.add(node.id);
      }
      lines.push('  end');
      lines.push('');
    }
  }

  // Remaining nodes
  for (const node of graph.nodes) {
    if (!renderedNodes.has(node.id)) {
      lines.push(renderNode(node));
    }
  }
  lines.push('');

  // ── Edges ──
  for (const edge of graph.edges) {
    lines.push(renderEdge(edge));
  }
  lines.push('');

  // ── linkStyle for edge coloring ──
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (edge.style === 'dashed' || edge.style === 'dotted') {
      lines.push(`  linkStyle ${i} stroke:#d4b07a,stroke-width:1.5px`);
    } else {
      lines.push(`  linkStyle ${i} stroke:#7a6b5c,stroke-width:1.5px`);
    }
  }
  lines.push('');

  // ── Apply classes ──

  // Status classes (highest priority — override type classes)
  const statusGroups: Record<string, string[]> = { verified: [], incorrect: [], assumption: [] };
  const typeGroups: Record<string, string[]> = {
    actionNode: [], personNode: [], systemNode: [], ideaNode: [],
    factNode: [], processNode: [], decisionNode: [],
  };

  for (const node of graph.nodes) {
    const sid = safeId(node.id);
    // Type class
    const typeMap: Record<string, string> = {
      action: 'actionNode', person: 'personNode', system: 'systemNode',
      idea: 'ideaNode', fact: 'factNode', process: 'processNode', decision: 'decisionNode',
    };
    const tc = typeMap[node.type];
    if (tc) typeGroups[tc].push(sid);

    // Status class (overrides type)
    if (node.status === 'verified') statusGroups.verified.push(sid);
    else if (node.status === 'incorrect') statusGroups.incorrect.push(sid);
    else if (node.status === 'assumption') statusGroups.assumption.push(sid);
  }

  // Apply type classes first (status will override)
  for (const [cls, ids] of Object.entries(typeGroups)) {
    if (ids.length > 0) lines.push(`  class ${ids.join(',')} ${cls}`);
  }

  // Apply status classes (override)
  for (const [cls, ids] of Object.entries(statusGroups)) {
    if (ids.length > 0) lines.push(`  class ${ids.join(',')} ${cls}`);
  }

  // Apply conversation classes (for nodes without a status override)
  if (conversations && conversations.length > 0) {
    for (const conv of conversations) {
      const ids = graph.nodes.filter(n => n.conversationId === conv.id).map(n => safeId(n.id));
      if (ids.length > 0) {
        // Only apply conv colors to nodes without status styling (status classes take priority)
        const noStatus = ids.filter(sid => {
          const n = graph.nodes.find(nd => safeId(nd.id) === sid);
          return !n?.status || n.status === 'pending';
        });
        if (noStatus.length > 0) lines.push(`  class ${noStatus.join(',')} conv_${conv.id}`);
      }
    }
  }

  return lines.join('\n');
}

// ── Sequence Diagram ──

function renderSequence(graph: GraphJSON): string {
  const lines: string[] = ['sequenceDiagram'];

  // Collect all participants: prioritize person/system nodes, fall back to edge references
  const participantMap = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.type === 'person' || n.type === 'system') {
      participantMap.set(n.id, n);
    }
  }

  // Also add any nodes referenced in edges that aren't already participants
  for (const e of graph.edges) {
    if (!participantMap.has(e.from)) {
      const n = graph.nodes.find(nd => nd.id === e.from);
      if (n) participantMap.set(n.id, n);
    }
    if (!participantMap.has(e.to)) {
      const n = graph.nodes.find(nd => nd.id === e.to);
      if (n) participantMap.set(n.id, n);
    }
  }

  for (const [, p] of participantMap) {
    lines.push(`  participant ${safeId(p.id)} as ${san(p.label)}`);
  }
  lines.push('');

  for (const edge of graph.edges) {
    // Skip edges where both participants aren't in our participant map
    if (!participantMap.has(edge.from) || !participantMap.has(edge.to)) continue;
    const label = edge.label ? san(edge.label) : ' ';
    const arrow = edge.style === 'dashed' ? '-->>' : '->>';
    lines.push(`  ${safeId(edge.from)}${arrow}${safeId(edge.to)}: ${label}`);
  }

  return lines.join('\n');
}

// ── Mindmap ──

function renderMindmap(graph: GraphJSON): string {
  const lines: string[] = ['mindmap'];
  lines.push(`  root("${san(graph.title || 'Ideas')}")`);

  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of graph.edges) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
    hasParent.add(e.to);
  }

  const roots = graph.nodes.filter(n => !hasParent.has(n.id));
  const rendered = new Set<string>();

  function renderBranch(nodeId: string, depth: number) {
    if (rendered.has(nodeId)) return;
    rendered.add(nodeId);
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) return;
    lines.push(`${'  '.repeat(depth + 1)}${san(node.label)}`);
    for (const kid of children.get(nodeId) || []) renderBranch(kid, depth + 1);
  }

  for (const root of roots) renderBranch(root.id, 1);
  for (const node of graph.nodes) {
    if (!rendered.has(node.id)) lines.push(`    ${san(node.label)}`);
  }

  return lines.join('\n');
}

// ── Main export ──

export function graphToMermaid(graph: GraphJSON, conversations?: ConversationSegment[]): string {
  if (!graph || !graph.nodes || graph.nodes.length === 0) return '';
  try {
    switch (graph.type) {
      case 'sequence': return renderSequence(graph);
      case 'mindmap': return renderMindmap(graph);
      default: return renderFlowchart(graph, conversations);
    }
  } catch (err) {
    console.error('Mermaid gen error:', err);
    return '';
  }
}

/**
 * Fallback: generate a simplified flowchart with only basic rectangles and
 * no subgraphs. Used when the main renderer produces invalid Mermaid syntax.
 */
export function graphToMermaidSimple(graph: GraphJSON): string {
  if (!graph || !graph.nodes || graph.nodes.length === 0) return '';
  try {
    const dir = chooseDirection(graph);
    const lines: string[] = [`flowchart ${dir}`];

    // Simple class defs
    lines.push(`  classDef verified fill:${PALETTE.green.fill},stroke:${PALETTE.green.stroke},stroke-width:3px,color:${PALETTE.green.text}`);
    lines.push(`  classDef incorrect fill:${PALETTE.red.fill},stroke:${PALETTE.red.stroke},stroke-width:3px,color:${PALETTE.red.text}`);
    lines.push(`  classDef assumption fill:${PALETTE.yellow.fill},stroke:${PALETTE.yellow.stroke},stroke-width:2px,color:${PALETTE.yellow.text}`);
    lines.push(`  classDef defaultNode fill:#2a2219,stroke:#9c8b78,stroke-width:1px,color:#d4c4b0`);
    lines.push('');

    // All nodes as simple rectangles
    for (const node of graph.nodes) {
      lines.push(renderNode(node, true));
    }
    lines.push('');

    // Simple edges (no labels to avoid syntax issues)
    for (const edge of graph.edges) {
      const from = safeId(edge.from);
      const to = safeId(edge.to);
      lines.push(`  ${from} --> ${to}`);
    }
    lines.push('');

    // Apply status classes
    const statusGroups: Record<string, string[]> = { verified: [], incorrect: [], assumption: [] };
    const defaultIds: string[] = [];
    for (const node of graph.nodes) {
      const sid = safeId(node.id);
      if (node.status === 'verified') statusGroups.verified.push(sid);
      else if (node.status === 'incorrect') statusGroups.incorrect.push(sid);
      else if (node.status === 'assumption') statusGroups.assumption.push(sid);
      else defaultIds.push(sid);
    }
    if (defaultIds.length > 0) lines.push(`  class ${defaultIds.join(',')} defaultNode`);
    for (const [cls, ids] of Object.entries(statusGroups)) {
      if (ids.length > 0) lines.push(`  class ${ids.join(',')} ${cls}`);
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

// ── Merge graphs incrementally ──

export function mergeGraphs(existing: GraphJSON, incoming: GraphJSON): GraphJSON {
  const nodeMap = new Map(existing.nodes.map(n => [n.id, { ...n }]));

  for (const node of incoming.nodes) {
    if (nodeMap.has(node.id)) {
      const ex = nodeMap.get(node.id)!;
      nodeMap.set(node.id, {
        ...ex,
        ...node,
        status: node.status || ex.status,
        conversationId: node.conversationId || ex.conversationId,
      });
    } else {
      nodeMap.set(node.id, { ...node });
    }
  }

  const edgeKey = (e: GraphEdge) => `${e.from}->${e.to}`;
  const edgeMap = new Map(existing.edges.map(e => [edgeKey(e), e]));
  for (const edge of incoming.edges) edgeMap.set(edgeKey(edge), edge);

  const clusterMap = new Map((existing.clusters || []).map(c => [c.id, c]));
  for (const c of incoming.clusters || []) {
    if (clusterMap.has(c.id)) {
      const ex = clusterMap.get(c.id)!;
      clusterMap.set(c.id, { ...ex, nodeIds: [...new Set([...ex.nodeIds, ...c.nodeIds])] });
    } else {
      clusterMap.set(c.id, c);
    }
  }

  const allNodes = Array.from(nodeMap.values());
  const allNodeIds = new Set(allNodes.map(n => n.id));

  // Prune if over 60 nodes
  if (allNodes.length > 60) {
    const connectivity = new Map<string, number>();
    allNodes.forEach(n => connectivity.set(n.id, 0));
    for (const e of edgeMap.values()) {
      connectivity.set(e.from, (connectivity.get(e.from) || 0) + 1);
      connectivity.set(e.to, (connectivity.get(e.to) || 0) + 1);
    }
    const sorted = allNodes.sort((a, b) => (connectivity.get(b.id) || 0) - (connectivity.get(a.id) || 0));
    const keep = new Set(sorted.slice(0, 60).map(n => n.id));
    allNodes.length = 0;
    allNodes.push(...sorted.filter(n => keep.has(n.id)));
    allNodeIds.clear();
    allNodes.forEach(n => allNodeIds.add(n.id));
  }

  return {
    type: incoming.type || existing.type,
    title: incoming.title || existing.title,
    nodes: allNodes,
    edges: Array.from(edgeMap.values()).filter(e => allNodeIds.has(e.from) && allNodeIds.has(e.to)),
    clusters: Array.from(clusterMap.values()),
  };
}

export function emptyGraph(): GraphJSON {
  return { type: 'flowchart', nodes: [], edges: [] };
}
