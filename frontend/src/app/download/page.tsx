'use client';

import Link from 'next/link';
import { Mic, Network, ShieldCheck, Apple, ArrowLeft, Download, Cpu, MessageSquare, EyeOff, Sparkles } from 'lucide-react';

const DMG_URL = 'https://github.com/Manueldav2/VisboardAI/releases/download/listener-v0.4.0/Gideon.Listener-0.4.0-arm64.dmg';

const FEATURES = [
  { icon: Sparkles, title: 'It writes your notes for you', desc: 'Jot a few rough bullets — Gideon hears the whole meeting and Enhances them into clean notes: TL;DR, key points, decisions, action items.' },
  { icon: Mic, title: 'Hears the whole room', desc: 'Captures your mic and system audio — no bot joins the call — and attributes who said what.' },
  { icon: MessageSquare, title: 'Chat with your meeting', desc: '“Summarize this”, “what were the action items?”, “what should I say?” — instant answers over the transcript.' },
  { icon: Network, title: 'Live thought map', desc: 'The conversation also becomes a growing diagram in real time — something no other notepad does.' },
  { icon: ShieldCheck, title: 'Explains jargon & catches fallacies', desc: 'Defines acronyms as they’re said (CAC, LP, ARR…) and flags logical fallacies and shaky claims live.' },
  { icon: EyeOff, title: 'Menu bar + hidden from screen shares', desc: 'Lives in your menu bar as a pill; the overlay floats on top but is invisible to Zoom, Meet, and recording.' },
];

export default function DownloadPage() {
  return (
    <div className="dl-root">
      <div className="hero-glow" aria-hidden />

      <header className="dl-nav">
        <Link href="/" className="dl-back"><ArrowLeft size={16} /> Gideon</Link>
      </header>

      <section className="dl-hero">
        <span className="dl-kicker">Gideon Listener · Desktop</span>
        <h1 className="dl-title">
          Turn Gideon on.<br /><em>It listens, and maps your thinking.</em>
        </h1>
        <p className="dl-sub">
          A Granola-style companion for meetings and thinking out loud. Start it, talk,
          and watch a live map form — with transcripts, notes, and fact-checks.
        </p>

        <div className="dl-cta">
          <a href={DMG_URL} className="dl-btn">
            <Download size={18} /> Download for macOS
          </a>
          <span className="dl-plat"><Apple size={13} /> Apple Silicon · macOS 26 · v0.4.0 · 100 MB</span>
        </div>

        <div className="dl-note">
          <b>First launch:</b> it&apos;s not notarized yet, so macOS blocks it once. Open it,
          then go to <b>System Settings → Privacy &amp; Security</b> and click <b>Open Anyway</b>.
          Allow <b>Microphone</b> and <b>Screen Recording</b> when asked.
        </div>
      </section>

      <section className="dl-grid">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="dl-card">
              <span className="dl-card-icon"><Icon size={18} /></span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          );
        })}
      </section>

      <section className="dl-steps">
        <h2 className="dl-steps-h">How it works</h2>
        <ol>
          <li><span>1</span> Open Gideon Listener and pick a mode — Thought Plot, Architecture, or Debate.</li>
          <li><span>2</span> Hit <b>Listen</b>. It captures your voice and streams it to Gideon.</li>
          <li><span>3</span> It transcribes and draws your thinking as a live diagram — corrections included.</li>
        </ol>
        <p className="dl-foot">
          Windows build and code-signing are coming next. Global hotkeys: ⌘\ hide · ⌘⇧L listen · ⌘⇧A ask.
        </p>
      </section>

      {/* Thumb-zone CTA (mobile): always reachable at the bottom */}
      <a href={DMG_URL} className="dl-sticky">
        <Download size={18} /> Download for macOS
      </a>
    </div>
  );
}
