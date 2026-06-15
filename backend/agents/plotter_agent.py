"""Agent 3 -- Thought Plot Agent.

Uses Gemini 2.0 Flash (REST) to decide whether a transcript chunk warrants
a graph update and, if so, returns the incremental node/edge additions
with rich type information for visual decomposition.
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from google import genai

from agents.prompts import PLOTTER_PROMPTS, DEFAULT_PLOTTER_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

MODEL = "gemini-2.5-flash"

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "should_plot": {
            "type": "boolean",
            "description": "Whether to add to the graph right now.",
        },
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": [
                            "process",
                            "decision",
                            "action",
                            "fact",
                            "assumption",
                            "system",
                            "person",
                            "idea",
                        ],
                    },
                    "cluster": {
                        "type": "string",
                        "description": "Optional cluster ID this node belongs to.",
                    },
                },
                "required": ["id", "label", "type"],
            },
            "description": "New nodes to add.",
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "label": {"type": "string"},
                    "style": {
                        "type": "string",
                        "enum": ["solid", "dashed", "dotted"],
                    },
                },
                "required": ["from", "to", "label"],
            },
            "description": "New edges to add.",
        },
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "node_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["id", "label", "node_ids"],
            },
            "description": "Node groups for visual clustering in the diagram.",
        },
        "graph_type": {
            "type": "string",
            "enum": ["flowchart", "mindmap"],
            "description": "The layout style for the graph.",
        },
    },
    "required": ["should_plot", "nodes", "edges", "graph_type"],
}


async def should_plot(
    transcript_chunk: str,
    mode: str,
    context: str,
    existing_graph: dict | None = None,
) -> dict | None:
    """Evaluate whether the transcript chunk should produce a graph update.

    Args:
        transcript_chunk: The latest text from the study session.
        mode: ThoughtPlot mode (determines the system prompt).
        context: Assembled session context from the memory service.
        existing_graph: The current state of the graph (nodes + edges) so
            the agent can avoid duplicates and connect to existing nodes.

    Returns:
        A dict with keys ``nodes``, ``edges``, ``clusters``, ``graph_type``
        if a plot update is warranted, or ``None`` if the agent decides
        not to plot.
    """
    system_prompt = PLOTTER_PROMPTS.get(mode, DEFAULT_PLOTTER_PROMPT)

    existing_graph_str = "No existing graph yet."
    if existing_graph:
        try:
            existing_graph_str = json.dumps(existing_graph, indent=2)
        except (TypeError, ValueError):
            existing_graph_str = str(existing_graph)

    user_content = (
        f"## Session Context\n{context}\n\n"
        f"## Existing Graph\n{existing_graph_str}\n\n"
        f"## Transcript Chunk\n{transcript_chunk}\n\n"
        "Respond with a JSON object. Set should_plot to false with empty "
        "nodes/edges if nothing should be plotted. Use lowercase_underscored "
        "node IDs. Keep labels short (2-5 words). "
        "REMEMBER: decompose descriptions into multiple visual actors with "
        "relationships — do NOT create a single text-blob node."
    )

    try:
        response = await _client.aio.models.generate_content(
            model=MODEL,
            contents=user_content,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.3,
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_schema=_RESPONSE_SCHEMA,
            ),
        )

        text = response.text
        if not text:
            logger.warning("Plotter agent returned empty response for mode=%s", mode)
            return None

        data = json.loads(text)

        if not data.get("should_plot", False):
            return None

        return {
            "nodes": data.get("nodes", []),
            "edges": data.get("edges", []),
            "clusters": data.get("clusters", []),
            "graph_type": data.get("graph_type", "flowchart"),
        }

    except json.JSONDecodeError:
        logger.exception("Plotter agent returned invalid JSON for mode=%s", mode)
        return None
    except Exception:
        logger.exception("Plotter agent failed for mode=%s", mode)
        return None
