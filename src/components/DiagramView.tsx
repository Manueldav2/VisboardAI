import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, Maximize2, Loader2 } from 'lucide-react';
import type { GraphJSON, ConversationSegment } from '../types';
import { graphToMermaid, graphToMermaidSimple } from '../services/graphEngine';

interface Props {
  graph: GraphJSON;
  conversations: ConversationSegment[];
  isExtracting: boolean;
}

let mermaidReady = false;

function initMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    darkMode: true,
    themeVariables: {
      primaryColor: '#2a2219',
      primaryTextColor: '#f5ede3',
      primaryBorderColor: '#c9a282',
      lineColor: '#7a6b5c',
      secondaryColor: '#211b15',
      tertiaryColor: '#2a2219',
      fontFamily: '"Plus Jakarta Sans", -apple-system, sans-serif',
      fontSize: '13px',
      nodeBorder: '#7a6b5c',
      clusterBkg: '#1a1510',
      clusterBorder: '#4d3f33',
      edgeLabelBackground: '#211b15',
      mainBkg: '#2a2219',
      textColor: '#f5ede3',
      nodeTextColor: '#f5ede3',
      noteBkgColor: '#2a2219',
      noteTextColor: '#f5ede3',
      noteBorderColor: '#4d3f33',
      actorBkg: '#2a2219',
      actorTextColor: '#f5ede3',
      actorBorder: '#c9a282',
      actorLineColor: '#7a6b5c',
      signalColor: '#f5ede3',
      signalTextColor: '#f5ede3',
      labelBoxBkgColor: '#2a2219',
      labelBoxBorderColor: '#4d3f33',
      labelTextColor: '#f5ede3',
      loopTextColor: '#c9a282',
      activationBorderColor: '#c9a282',
      activationBkgColor: '#332a20',
      sequenceNumberColor: '#c9a282',
    },
    flowchart: {
      curve: 'basis',
      padding: 20,
      htmlLabels: true,
      useMaxWidth: false,
      nodeSpacing: 50,
      rankSpacing: 60,
    },
    sequence: {
      useMaxWidth: false,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
      mirrorActors: false,
      actorFontFamily: '"Plus Jakarta Sans", sans-serif',
      messageFontFamily: '"Plus Jakarta Sans", sans-serif',
    },
    securityLevel: 'loose',
    logLevel: 'error' as any,
  });
  mermaidReady = true;
}

export default function DiagramView({ graph, conversations, isExtracting }: Props) {
  const svgRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const renderCounter = useRef(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  const renderDiagram = useCallback(async () => {
    initMermaid();
    if (!svgRef.current) return;

    const code = graphToMermaid(graph, conversations);
    if (!code) {
      svgRef.current.innerHTML = '';
      setRenderError(null);
      return;
    }

    const id = `tp_${++renderCounter.current}`;

    const tryRender = async (mermaidCode: string, renderId: string): Promise<boolean> => {
      if (!svgRef.current) return false;
      const valid = await mermaid.parse(mermaidCode).catch(() => false);
      if (valid === false) return false;

      const { svg } = await mermaid.render(renderId, mermaidCode);
      if (!svgRef.current) return false;

      svgRef.current.innerHTML = svg;
      const svgEl = svgRef.current.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('height');
        svgEl.style.maxWidth = 'none';
        svgEl.style.width = 'auto';
        svgEl.style.height = 'auto';
        svgEl.style.minWidth = '300px';
      }
      return true;
    };

    try {
      svgRef.current.style.opacity = '0.3';

      // Try full-featured render first
      let success = await tryRender(code, id).catch(() => false);

      // If that fails, try simplified fallback (basic rectangles, no subgraphs)
      if (!success) {
        console.warn('Mermaid primary render failed, trying simplified fallback');
        const simpleCode = graphToMermaidSimple(graph);
        if (simpleCode) {
          success = await tryRender(simpleCode, `${id}_s`).catch(() => false);
        }
      }

      if (success) {
        setRenderError(null);
      } else {
        setRenderError('Syntax error — retrying next update');
        console.warn('Mermaid parse error (both renderers failed):', code);
      }

      requestAnimationFrame(() => {
        if (svgRef.current) svgRef.current.style.opacity = '1';
      });
    } catch (err: any) {
      console.warn('Mermaid render error:', err?.message || err);
      // Last resort: try simplified
      try {
        const simpleCode = graphToMermaidSimple(graph);
        if (simpleCode && svgRef.current) {
          const fallbackSuccess = await tryRender(simpleCode, `${id}_fb`).catch(() => false);
          if (fallbackSuccess) {
            setRenderError(null);
          } else {
            setRenderError('Render failed — will update on next extraction');
          }
        }
      } catch { /* give up */ }
      if (svgRef.current) svgRef.current.style.opacity = '1';
    }
  }, [graph, conversations]);

  useEffect(() => {
    const timer = setTimeout(renderDiagram, 120);
    return () => clearTimeout(timer);
  }, [renderDiagram]);

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };
  const onPointerUp = () => setDragging(false);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.15, Math.min(4, z - e.deltaY * 0.001)));
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const isEmpty = graph.nodes.length === 0;

  return (
    <div className="diagram-view">
      <div className="diagram-controls">
        {isExtracting && (
          <div className="extracting-indicator">
            <Loader2 size={14} className="spin" />
            <span>Mapping</span>
          </div>
        )}
        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="Zoom in"><ZoomIn size={16} /></button>
        <button onClick={() => setZoom(z => Math.max(0.15, z - 0.25))} title="Zoom out"><ZoomOut size={16} /></button>
        <button onClick={resetView} title="Reset view"><Maximize2 size={16} /></button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      </div>

      {!isEmpty && (
        <div className="diagram-type-badge">
          {graph.type}{graph.title ? ` — ${graph.title}` : ''}
        </div>
      )}

      <div
        className="diagram-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: dragging ? 'grabbing' : isEmpty ? 'default' : 'grab' }}
      >
        {isEmpty ? (
          <div className="diagram-empty">
            {isExtracting ? (
              <>
                <Loader2 size={40} className="spin" style={{ opacity: 0.3 }} />
                <p>Extracting structure...</p>
              </>
            ) : (
              <>
                <div className="diagram-empty-icon">
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <circle cx="12" cy="12" r="3" opacity="0.5" />
                    <circle cx="5" cy="6" r="2" opacity="0.4" />
                    <circle cx="19" cy="6" r="2" opacity="0.4" />
                    <circle cx="5" cy="18" r="2" opacity="0.4" />
                    <circle cx="19" cy="18" r="2" opacity="0.4" />
                    <line x1="9.5" y1="10.5" x2="6.5" y2="7.5" />
                    <line x1="14.5" y1="10.5" x2="17.5" y2="7.5" />
                    <line x1="9.5" y1="13.5" x2="6.5" y2="16.5" />
                    <line x1="14.5" y1="13.5" x2="17.5" y2="16.5" />
                  </svg>
                </div>
                <p>Start speaking or paste text<br />to build a thought plot</p>
              </>
            )}
          </div>
        ) : (
          <div
            ref={svgRef}
            className="diagram-svg"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          />
        )}
      </div>

      {renderError && <div className="diagram-error">{renderError}</div>}
      {!isEmpty && <div className="diagram-stats">{graph.nodes.length} nodes · {graph.edges.length} edges</div>}
    </div>
  );
}
