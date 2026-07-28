'use client';

import Link from 'next/link';
import { Mic, Network, ShieldCheck, Apple, ArrowLeft, Download, Cpu } from 'lucide-react';

const DMG_URL = 'https://github.com/Manueldav2/VisboardAI/releases/download/listener-v0.1.0/Gideon.Listener-0.1.0-arm64.dmg';

const FEATURES = [
  { icon: Mic, title: 'Turn it on and talk', desc: 'A floating companion that listens while you think or meet — no tab, no typing.' },
  { icon: Network, title: 'Live thought map', desc: 'Everything you say becomes a growing Mermaid diagram in real time.' },
  { icon: ShieldCheck, title: 'Quietly fact-checks', desc: 'Flags shaky claims as you go, and attributes what a speaker said to the speaker.' },
  { icon: Cpu, title: 'Powered by Gemini', desc: 'Transcription and mapping run on Gemini — nothing else needed.' },
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
          <span className="dl-plat"><Apple size={13} /> Apple Silicon · v0.1.0 · 94 MB</span>
        </div>

        <div className="dl-note">
          <b>First launch:</b> it&apos;s not code-signed yet, so macOS will warn you.
          Right-click the app → <b>Open</b> → <b>Open</b>, and allow the microphone.
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
          <li><span>3</span> Gemini transcribes and draws your thinking as a live diagram — corrections included.</li>
        </ol>
        <p className="dl-foot">
          Windows build and system-audio capture (hear the whole meeting) are coming next.
        </p>
      </section>
    </div>
  );
}
