"""Pydantic models for request/response validation and internal data structures."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Transcript / WebSocket payloads
# ---------------------------------------------------------------------------

class TranscriptChunk(BaseModel):
    """A single chunk of transcript text coming from the client."""

    text: str
    mode: str = "general"
    class_id: str | None = None
    topic: str | None = None
    tool: str | None = None  # e.g. "thought_plot"


# ---------------------------------------------------------------------------
# Agent outputs
# ---------------------------------------------------------------------------

class RouterDecision(BaseModel):
    """Output of the Router Agent (Agent 1)."""

    should_respond: bool = Field(
        description="Whether the AI should respond to this transcript chunk."
    )
    response_instruction: str = Field(
        default="",
        description="Instruction for the Voice Agent on what to say and why.",
    )
    response_type: str = Field(
        default="silent",
        description=(
            "The type of response: 'correction', 'question', 'explanation', "
            "'encouragement', 'quiz_question', or 'silent'."
        ),
    )
    detected_level: str | None = Field(
        default=None,
        description="Student's detected language proficiency (language mode only).",
    )


class GraphNode(BaseModel):
    id: str
    label: str
    type: str = "idea"  # process, decision, action, fact, assumption, system, person, idea
    cluster: str | None = None


class GraphEdge(BaseModel):
    source: str = Field(alias="from", serialization_alias="from")
    to: str
    label: str = ""
    style: str = "solid"  # solid, dashed, dotted

    class Config:
        populate_by_name = True


class GraphCluster(BaseModel):
    id: str
    label: str
    node_ids: list[str] = Field(default_factory=list)


class PlotUpdate(BaseModel):
    """Output of the Plotter Agent (Agent 3)."""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    clusters: list[GraphCluster] = Field(default_factory=list)
    graph_type: str = "flowchart"  # 'flowchart' | 'mindmap'


class VoiceResponse(BaseModel):
    """Output of the Voice Agent (Agent 2)."""

    text: str
    should_speak: bool = True


# ---------------------------------------------------------------------------
# Material upload
# ---------------------------------------------------------------------------

class MaterialUpload(BaseModel):
    """Payload for uploading study material."""

    class_id: str
    title: str
    type: str = "text"  # 'pdf' | 'text'
    text: str | None = None


# ---------------------------------------------------------------------------
# Aggregated session context (internal use)
# ---------------------------------------------------------------------------

class FactCheckResult(BaseModel):
    """Output of the Fact-Checker Agent — one verified claim."""

    id: str = ""
    claim: str
    status: str = Field(
        default="assumption",
        description="'verified', 'incorrect', or 'assumption'.",
    )
    confidence: float = Field(default=0.5, ge=0, le=1)
    correction: str = ""
    explanation: str = ""
    source_excerpt: str = ""


class IntentClassification(BaseModel):
    """Output of the Intent Classifier for general chat routing."""

    tool: str = Field(
        default="general",
        description=(
            "Which tool to route to: 'study_buddy', 'thought_plot', "
            "'architect', 'argument_ref', or 'general'."
        ),
    )
    mode: str = Field(
        default="general",
        description=(
            "Sub-mode within the tool (e.g. 'quiz', 'guided_study', "
            "'cram', 'language', 'referee', 'harvey')."
        ),
    )
    confidence: float = Field(
        default=0.0,
        description="Confidence score 0-1 for the classification.",
    )
    reason: str = Field(
        default="",
        description="Brief explanation of why this tool/mode was chosen.",
    )


class SessionContext(BaseModel):
    """Aggregated context fed to AI agents."""

    class_info: dict | None = None
    materials: list[str] = Field(default_factory=list)
    summaries: list[str] = Field(default_factory=list)
    mastery: list[dict] = Field(default_factory=list)
