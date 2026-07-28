'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { WS_BASE } from '@/lib/api';
import { useSpeechRecognition } from '@/lib/useSpeechRecognition';
import { useIsMobile } from '@/lib/useIsMobile';
import { MermaidExport } from '@/components/MermaidExport';
import {
  Mic, Square, Network, Blocks, ShieldCheck, ShieldOff, ArrowUp,
  ZoomIn, ZoomOut, RotateCcw, AlertTriangle, HelpCircle,
  Plus, RadioTower, ArrowLeft, Brain, BookOpen, Zap, Globe, Target,
  Scale, Swords, GraduationCap, Sparkles, CheckCircle2,
} from 'lucide-react';

type Family = 'map' | 'chat';
interface ModeDef {
  id: string; family: Family; tool: string; bmode: string;
  group: string; label: string; icon: React.ComponentType<{ size?: number }>;
  color: string; desc: string;
}

const MODES: ModeDef[] = [
  { id: 'thought', family: 'map', tool: 'thought_plot', bmode: 'general', group: 'Think', label: 'Thought Plot', icon: Network, color: 'var(--accent)', desc: 'Talk freely — watch your thinking become a live map.' },
  { id: 'architect', family: 'map', tool: 'architect', bmode: 'default', group: 'Think', label: 'Architecture', icon: Blocks, color: 'var(--teal)', desc: 'Describe an app — get a system diagram and stack.' },
  { id: 'quiz', family: 'chat', tool: 'study_buddy', bmode: 'quiz', group: 'Study', label: 'Quiz me', icon: Brain, color: 'var(--blue)', desc: 'Adaptive questions that sharpen as you go.' },
  { id: 'guided', family: 'chat', tool: 'study_buddy', bmode: 'guided_study', group: 'Study', label: 'Guided study', icon: BookOpen, color: 'var(--violet)', desc: 'A patient tutor that explains, then checks.' },
  { id: 'cram', family: 'chat', tool: 'study_buddy', bmode: 'cram', group: 'Study', label: 'Cram', icon: Zap, color: 'var(--red)', desc: 'High-yield facts, fast, no filler.' },
  { id: 'language', family: 'chat', tool: 'study_buddy', bmode: 'language', group: 'Study', label: 'Language', icon: Globe, color: 'var(--green)', desc: 'Immersive practice with gentle corrections.' },
  { id: 'strategy', family: 'chat', tool: 'study_buddy', bmode: 'strategy', group: 'Study', label: 'Strategy', icon: Target, color: 'var(--amber)', desc: 'A concrete plan for what to study, and how.' },
  { id: 'referee', family: 'chat', tool: 'argument_ref', bmode: 'referee', group: 'Debate', label: 'Debate referee', icon: Scale, color: 'var(--rose)', desc: 'Argue a point — it calls every fallacy.' },
  { id: 'harvey', family: 'chat', tool: 'argument_ref', bmode: 'harvey', group: 'Debate', label: 'Harvey Specter', icon: Swords, color: 'var(--red)', desc: 'Ruthless opposing counsel. Defend your case.' },
];
const GROUPS = ['Think', 'Study', 'Debate'];

interface Flag { id: string; status: string; claim: string; correction: string; explanation: string; }
interface Line { id: string; who: 'you' | 'gideon'; text: string; }
interface Signal { id: string; kind: 'fallacy' | 'technique'; name: string; detail: string; tone: string; }
interface Tool { id?: string; name: string; monthly_cost?: number; }

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

export default function GideonPage() {
  const isMobile = useIsMobile();

  const [modeId, setModeId] = useState<string | null>(null);
  const mode = MODES.find(m => m.id === modeId) || null;
  const [factCheck, setFactCheck] = useState(true);
  const [mermaidCode, setMermaidCode] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [archStack, setArchStack] = useState<Tool[]>([]);
  const [interim, setInterim] = useState('');
  const [textInput, setTextInput] = useState('');
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [banner, setBanner] = useState<string | null>(null);
  const [hello, setHello] = useState('Welcome');
  const [thinking, setThinking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const factRef = useRef(factCheck); factRef.current = factCheck;
  const mapRef = useRef<HTMLDivElement>(null);
  const mermaidInit = useRef(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const isMap = mode?.family === 'map';
  useEffect(() => { setHello(greeting()); }, []);

  // ── WebSocket ──
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_BASE}/ws/study-session`);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        switch (d.type) {
          case 'plot_update':
            if (d.graph?.mermaid_code) setMermaidCode(d.graph.mermaid_code);
            break;
          case 'fact_check': {
            const ok = d.status === 'incorrect' || (d.status === 'assumption' && (d.confidence || 0) >= 0.6);
            if (ok && d.status !== 'verified') {
              setFlags(p => [{ id: crypto.randomUUID(), status: d.status, claim: d.claim || '', correction: d.correction || '', explanation: d.explanation || '' }, ...p].slice(0, 40));
            }
            break;
          }
          case 'ai_response':
            setThinking(false);
            if (d.text) setLines(p => [...p, { id: crypto.randomUUID(), who: 'gideon', text: d.text }]);
            break;
          case 'fallacy_call':
            if (d.fallacy) setSignals(p => [{ id: crypto.randomUUID(), kind: 'fallacy' as const, name: d.fallacy.name, detail: d.fallacy.why_its_wrong || d.fallacy.what_was_said || '', tone: 'bad' }, ...p].slice(0, 40));
            break;
          case 'technique_detected':
            if (d.technique?.name && d.technique.name !== 'None') setSignals(p => [{ id: crypto.randomUUID(), kind: 'technique' as const, name: d.technique.name, detail: d.technique.feedback || '', tone: d.technique.quality === 'effective' ? 'good' : 'warn' }, ...p].slice(0, 40));
            break;
          case 'architecture_state':
            if (d.panel?.stack?.length) setArchStack(d.panel.stack);
            break;
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => setBanner('Connection issue — retrying as you speak.');
    wsRef.current = ws;
  }, []);

  const send = useCallback((text: string) => {
    const t = text.trim();
    const m = modeRef.current;
    if (!t || !m) return;
    setLines(p => [...p, { id: crypto.randomUUID(), who: 'you', text: t }]);
    if (m.family === 'chat') {
      setThinking(true);
      // Don't spin forever if a reply can't arrive (e.g. API not funded).
      window.setTimeout(() => setThinking(false), 22000);
    }
    const payload = m.family === 'map'
      ? { type: 'realtime_transcript', text: t, tool: m.tool, mode: 'general', fact_check_enabled: factRef.current, voice_enabled: false }
      : { type: 'transcript', text: t, tool: m.tool, mode: m.bmode };
    const doSend = (tries = 0) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload));
      else if (tries < 20) setTimeout(() => doSend(tries + 1), 150);
    };
    doSend();
  }, []);

  const { start: startSTT, stop: stopSTT, isActive: listening, error: sttError } = useSpeechRecognition({
    onResult: (t) => { setInterim(''); send(t); },
    onInterim: (t) => setInterim(t),
  });
  useEffect(() => { if (sttError) setBanner(sttError); }, [sttError]);

  const openMode = useCallback((id: string) => {
    setModeId(id); setBanner(null);
    setLines([]); setFlags([]); setSignals([]); setArchStack([]); setMermaidCode(''); setZoom(1);
    connect();
  }, [connect]);

  const stopListening = useCallback(() => { stopSTT(); setInterim(''); }, [stopSTT]);

  const startTalking = useCallback(() => { if (!wsRef.current) connect(); startSTT(); }, [connect, startSTT]);

  const backToHome = useCallback(() => {
    stopSTT(); setInterim('');
    wsRef.current?.close(); wsRef.current = null;
    setModeId(null);
  }, [stopSTT]);

  const submitText = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const t = textInput.trim();
    if (!t) return;
    if (!wsRef.current) connect();
    send(t); setTextInput('');
  }, [textInput, connect, send]);

  // ── Mermaid ──
  useEffect(() => {
    if (mermaidInit.current) return;
    mermaidInit.current = true;
    import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false, suppressErrorRendering: true, theme: 'base', securityLevel: 'loose',
        themeVariables: { darkMode: true, background: '#0c0b09', primaryColor: '#1e1d1a', primaryTextColor: '#f5f3ed', primaryBorderColor: '#3d3a35', lineColor: '#716d65', secondaryColor: '#1e1d1a', tertiaryColor: '#161514', edgeLabelBackground: '#161514', clusterBkg: '#161514', clusterBorder: '#332f2a' },
        flowchart: { curve: 'basis', padding: 22, nodeSpacing: 70, rankSpacing: 65, diagramPadding: 24, htmlLabels: true },
      });
    });
  }, []);
  useEffect(() => {
    if (!mermaidCode) return;
    let cancelled = false;
    import('mermaid').then(async m => {
      try {
        const { svg } = await m.default.render(`mm-${Date.now()}`, mermaidCode);
        if (cancelled || !mapRef.current) return;
        mapRef.current.innerHTML = svg;
        // Auto-fit: scale a small diagram up (or a big one down) to fill the stage.
        const svgEl = mapRef.current.querySelector('svg');
        const scroll = mapRef.current.closest('.map-scroll') as HTMLElement | null;
        if (svgEl && scroll) {
          const vb = svgEl.viewBox?.baseVal;
          const natW = (vb && vb.width) || svgEl.getBoundingClientRect().width || 1;
          const natH = (vb && vb.height) || svgEl.getBoundingClientRect().height || 1;
          const cw = scroll.clientWidth - 64;
          const ch = scroll.clientHeight - 64;
          const fit = Math.max(0.5, Math.min(cw / natW, ch / natH, 2.4));
          svgEl.style.width = `${natW}px`;
          svgEl.style.height = `${natH}px`;
          setFitScale(fit);
        }
      } catch { /* keep last good render */ }
    });
    return () => { cancelled = true; };
  }, [mermaidCode]);

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines, flags, signals, thinking]);
  useEffect(() => () => { stopSTT(); wsRef.current?.close(); }, [stopSTT]);

  const exportMd = useCallback(() => {
    if (!mode) return;
    const out: string[] = [`# Gideon — ${mode.label}`, `*${new Date().toLocaleString()}*`, ''];
    if (lines.length) { out.push('## Conversation'); lines.forEach(l => out.push(`**${l.who === 'you' ? 'You' : 'Gideon'}:** ${l.text}\n`)); }
    if (mermaidCode) out.push('## Map', '```mermaid', mermaidCode, '```', '');
    if (flags.length) { out.push('## Fact-check'); flags.forEach(f => out.push(`- **${f.status}**: "${f.claim}" — ${f.correction || f.explanation}`)); }
    const blob = new Blob([out.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `gideon-${mode.id}-${new Date().toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(a.href);
  }, [mode, lines, mermaidCode, flags]);

  // ══════════════════════════════ HOME ══════════════════════════════
  if (!mode) {
    return (
      <div className="gid-root">
        <div className="home-scroll">
          <div className="hero-glow" aria-hidden />
          <div className="home-inner">
            <h1 className="greeting reveal">{hello}<span className="greeting-dot">.</span></h1>
            <p className="greeting-sub reveal">What do you want to think through? Pick how Gideon should help.</p>

            {GROUPS.map((g, gi) => (
              <div key={g} className="home-group reveal" style={{ animationDelay: `${0.08 + gi * 0.06}s` }}>
                <p className="home-group-title">{g}</p>
                <div className="mode-grid">
                  {MODES.filter(m => m.group === g).map(m => {
                    const Icon = m.icon;
                    return (
                      <button key={m.id} className="mode-card" style={{ ['--c' as string]: m.color }} onClick={() => openMode(m.id)}>
                        <span className="mode-card-icon"><Icon size={18} /></span>
                        <span className="mode-card-body">
                          <span className="mode-card-label">{m.label}</span>
                          <span className="mode-card-desc">{m.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                  {g === 'Study' && (
                    <Link href="/classes" className="mode-card" style={{ ['--c' as string]: 'var(--sand)' }}>
                      <span className="mode-card-icon"><GraduationCap size={18} /></span>
                      <span className="mode-card-body">
                        <span className="mode-card-label">My classes</span>
                        <span className="mode-card-desc">Upload materials; quiz from your own notes.</span>
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const ModeIcon = mode.icon;

  // ══════════════════════════════ SESSION ══════════════════════════════
  return (
    <div className="gid-root">
      {banner && (
        <div className="gid-banner">
          <AlertTriangle size={13} /><span>{banner}</span>
          <button onClick={() => setBanner(null)}>×</button>
        </div>
      )}

      <header className="gid-bar">
        <button className="bar-btn icon" onClick={backToHome} title="All modes"><ArrowLeft size={16} /></button>
        <span className="mode-badge" style={{ ['--c' as string]: mode.color }}><ModeIcon size={14} />{mode.label}</span>
        {isMap && (
          <button className={`fact-toggle ${factCheck ? 'on' : ''}`} onClick={() => setFactCheck(v => !v)} title="Toggle fact-check">
            {factCheck ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}<span>Fact-check</span>
          </button>
        )}
        <div className="gid-bar-spacer" />
        {listening
          ? <span className="live-chip"><RadioTower size={13} />Listening</span>
          : <button className="bar-btn" onClick={startTalking}><Mic size={14} />Talk</button>}
        {mermaidCode && <MermaidExport mermaidCode={mermaidCode} containerRef={mapRef} />}
        <button className="bar-btn" onClick={exportMd}>Export</button>
        <button className="bar-btn is-danger" onClick={backToHome}><Square size={13} />End</button>
      </header>

      <div className="gid-body">
        {isMap ? (
          <div className="map-stage">
            <div className="map-tools">
              <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))}><ZoomIn size={15} /></button>
              <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))}><ZoomOut size={15} /></button>
              <button onClick={() => setZoom(1)}><RotateCcw size={14} /></button>
            </div>
            {mermaidCode ? (
              <div className="map-scroll">
                <div style={{ transform: `scale(${fitScale * zoom})`, transformOrigin: 'top center', transition: 'transform 0.25s' }}>
                  <div ref={mapRef} className="mermaid-render" />
                </div>
              </div>
            ) : (
              <div className="map-empty">
                <div className="map-empty-orb" style={{ ['--c' as string]: mode.color }}><ModeIcon size={30} /></div>
                <p>{listening ? 'Listening… your map grows as you talk.' : mode.id === 'architect' ? 'Describe what you’re building and the diagram appears here.' : 'Start talking and your thinking appears here as a map.'}</p>
                {interim && <p className="map-interim">“{interim}”</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="chat-stage">
            <div className="chat-scroll">
              <div className="chat-col">
                {lines.length === 0 && (
                  <div className="chat-hello">
                    <span className="chat-hello-icon" style={{ ['--c' as string]: mode.color }}><ModeIcon size={22} /></span>
                    <p>{mode.desc}</p>
                    <span className="chat-hello-hint">Tap <Mic size={12} /> and start, or type below.</span>
                  </div>
                )}
                {lines.map(l => (
                  <div key={l.id} className={`msg-row ${l.who === 'you' ? 'is-user' : 'is-ai'}`}>
                    {l.who === 'gideon' && <span className="msg-avatar"><Network size={13} strokeWidth={2.5} /></span>}
                    <div className={`msg-bubble ${l.who === 'you' ? 'is-user' : 'is-ai'} ${isMobile ? 'max-w-[86%]' : 'max-w-2xl'}`}>
                      <span className="msg-name">{l.who === 'you' ? 'You' : 'Gideon'}</span>
                      <div className="msg-text">{l.text}</div>
                    </div>
                  </div>
                ))}
                {interim && <div className="msg-row is-user"><div className="msg-bubble is-user"><div className="msg-text ghost">{interim}</div></div></div>}
                {thinking && <div className="chat-thinking"><span /><span /><span />Gideon is thinking…</div>}
                <div ref={feedEndRef} />
              </div>
            </div>
          </div>
        )}

        {!isMobile && (isMap ? (flags.length > 0 || (mode.id === 'architect' && archStack.length > 0)) : signals.length > 0) && (
          <aside className="gid-rail">
            {mode.id === 'architect' && archStack.length > 0 && (
              <div className="rail-sec">
                <p className="rail-h">Stack</p>
                {archStack.slice(0, 10).map((t, i) => (
                  <div key={t.id || i} className="stack-row"><span>{t.name}</span><span className="stack-cost">{t.monthly_cost ? `$${t.monthly_cost}/mo` : 'Free'}</span></div>
                ))}
              </div>
            )}
            {isMap && flags.length > 0 && (
              <div className="rail-sec">
                <p className="rail-h">Fact-check</p>
                {flags.map(f => (
                  <div key={f.id} className={`flag ${f.status === 'incorrect' ? 'incorrect' : 'assumption'}`}>
                    <div className="flag-top">{f.status === 'incorrect' ? <AlertTriangle size={13} /> : <HelpCircle size={13} />}{f.status === 'incorrect' ? 'Likely wrong' : 'Worth checking'}</div>
                    <p className="flag-claim">“{f.claim}”</p>
                    {(f.correction || f.explanation) && <p className="flag-fix">{f.correction || f.explanation}</p>}
                  </div>
                ))}
              </div>
            )}
            {!isMap && signals.length > 0 && (
              <div className="rail-sec">
                <p className="rail-h">{mode.tool === 'argument_ref' ? 'Debate signals' : 'Notes'}</p>
                {signals.map(s => (
                  <div key={s.id} className={`flag ${s.tone === 'good' ? 'good' : s.tone === 'bad' ? 'incorrect' : 'assumption'}`}>
                    <div className="flag-top">{s.tone === 'good' ? <CheckCircle2 size={13} /> : s.kind === 'fallacy' ? <AlertTriangle size={13} /> : <Sparkles size={13} />}{s.kind === 'fallacy' ? 'Fallacy' : 'Technique'}</div>
                    <p className="flag-claim">{s.name}</p>
                    {s.detail && <p className="flag-fix">{s.detail}</p>}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="dock">
        <div className="dock-inner">
          <form onSubmit={submitText} className="composer2">
            <button type="button" className={`composer-icon ${listening ? 'is-live' : ''}`} onClick={() => { if (listening) stopListening(); else startTalking(); }} title={listening ? 'Pause' : 'Talk'}>
              {listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
            <input className="composer2-input" value={textInput} onChange={e => setTextInput(e.target.value)}
              placeholder={listening ? 'Listening… or type' : mode.id === 'architect' ? 'Describe what you’re building…' : isMap ? 'Type a thought, or tap the mic…' : `Talk to ${mode.label}…`} />
            <button type="submit" className="composer-send" disabled={!textInput.trim()} aria-label="Send"><ArrowUp size={17} /></button>
          </form>
          {isMap && <p className="dock-hint">Gideon maps silently and only flags things worth checking · double-check anything important</p>}
        </div>
      </div>
    </div>
  );
}
