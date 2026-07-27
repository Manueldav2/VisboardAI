'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Mic, MicOff, Brain, Blocks, Swords, Network, ArrowUpRight } from 'lucide-react';
import { ThoughtField } from './ThoughtField';

gsap.registerPlugin(useGSAP);

type RTStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  realtimeStatus: RTStatus;
  aiStatus: AIStatus;
  isMobile: boolean;
  onMic: () => void;
  onQuickAction: (prompt: string) => void;
}

const CAPABILITIES = [
  { icon: Brain, label: 'Quiz me', desc: 'Adaptive questions that sharpen as you go', prompt: 'Quiz me on something', color: 'var(--blue)' },
  { icon: Blocks, label: 'Plan an app', desc: 'A stack, costs and system diagram, live', prompt: 'Help me plan a software project', color: 'var(--teal)' },
  { icon: Swords, label: 'Debate practice', desc: 'A referee that names every fallacy', prompt: "Let's practice debate", color: 'var(--red)' },
  { icon: Network, label: 'Map a concept', desc: 'Think aloud; watch it become a graph', prompt: 'Help me map out a concept', color: 'var(--accent)' },
];

export function WelcomeHero({ realtimeStatus, aiStatus, isMobile, onMic, onQuickAction }: Props) {
  const connected = realtimeStatus === 'connected';
  const connecting = realtimeStatus === 'connecting';
  const scope = useRef<HTMLDivElement>(null);

  useGSAP((_ctx, contextSafe) => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.hero-pill', { y: 14, autoAlpha: 0, duration: 0.5 })
      .from('.hero-kicker', { y: 14, autoAlpha: 0, duration: 0.5 }, '-=0.35')
      .from('.hero-title', { y: 26, autoAlpha: 0, duration: 0.7 }, '-=0.3')
      .fromTo('.hero-underline',
        { scaleX: 0, autoAlpha: 0 },
        { scaleX: 1, autoAlpha: 0.9, duration: 0.85, ease: 'power2.inOut' }, '-=0.35')
      .from('.hero-sub', { y: 16, autoAlpha: 0, duration: 0.6 }, '-=0.65')
      .from('.instrument', { y: 18, autoAlpha: 0, scale: 0.88, duration: 0.65, ease: 'back.out(1.6)' }, '-=0.4')
      .from('.hero-hint', { autoAlpha: 0, duration: 0.4 }, '-=0.3')
      .from('.cap-tile', { y: 22, autoAlpha: 0, duration: 0.5, stagger: 0.07 }, '-=0.35');

    // Magnetic pull on the mic instrument — subtle, delightful, cleaned up on unmount.
    const instrument = scope.current?.querySelector<HTMLElement>('.instrument');
    if (instrument && contextSafe) {
      const onMove = contextSafe((e: MouseEvent) => {
        const r = instrument.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        gsap.to(instrument, { x: dx * 0.18, y: dy * 0.18, duration: 0.4, ease: 'power2.out' });
      });
      const onLeave = contextSafe(() => {
        gsap.to(instrument, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      });
      instrument.addEventListener('mousemove', onMove);
      instrument.addEventListener('mouseleave', onLeave);
      return () => {
        instrument.removeEventListener('mousemove', onMove);
        instrument.removeEventListener('mouseleave', onLeave);
      };
    }
  }, { scope });

  const statusLabel = connected
    ? (aiStatus === 'listening' ? 'Listening' : aiStatus === 'thinking' ? 'Thinking' : aiStatus === 'speaking' ? 'Speaking' : 'Connected')
    : connecting ? 'Connecting' : 'Ready';

  return (
    <div ref={scope} className="welcome-hero relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-5">
      {/* Ambient layers */}
      <div className="orb orb-gold" style={{ top: '8%', left: '12%' }} />
      <div className="orb orb-blue" style={{ bottom: '6%', right: '10%' }} />
      <ThoughtField active={connected} />
      <div className="hero-vignette" aria-hidden />

      {/* Content */}
      <div className="relative z-10 flex w-full max-w-[640px] flex-col items-center text-center">
        {/* Status pill */}
        <div className="hero-pill mb-8">
          <span className={`status-dot ${connected ? aiStatus : 'idle'}`} />
          <span>{statusLabel}</span>
          <span className="hero-pill-sep">/</span>
          <span className="hero-pill-mono">v2.0</span>
        </div>

        {/* Wordmark */}
        <p className="hero-kicker mb-4">A place to map your thoughts</p>
        <h1 className="hero-title">
          Gideon
          <span className="hero-underline" aria-hidden />
        </h1>
        <p className="hero-sub mt-6 mb-11">
          Think out loud. I&apos;ll quiz you, referee your debates, plan your
          architecture, and quietly turn what you say into a living map —{' '}
          <em>all through conversation.</em>
        </p>

        {/* Mic instrument */}
        <button
          onClick={onMic}
          className={`instrument ${connected ? 'is-live' : ''} ${connecting ? 'is-connecting' : ''}`}
          aria-label={connected ? 'Stop voice session' : 'Start voice session'}
          style={isMobile ? { transform: 'scale(1.08)' } : undefined}
        >
          <span className="instrument-ring r1" />
          <span className="instrument-ring r2" />
          <span className="instrument-core">
            {connected ? <MicOff size={22} /> : <Mic size={22} />}
          </span>
          {connected && (
            <span className="instrument-wave" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => <span key={i} />)}
            </span>
          )}
        </button>
        <p className="hero-hint mt-4">
          {connecting ? 'Connecting…' : connected ? 'Tap to end · or keep talking' : 'Tap to speak, or type below'}
        </p>

        {/* Capability tiles */}
        <div className="mt-12 grid w-full grid-cols-2 gap-2.5">
          {CAPABILITIES.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.label}
                onClick={() => onQuickAction(c.prompt)}
                className="cap-tile group"
                style={{ ['--tile-accent' as string]: c.color }}
              >
                <span className="cap-icon">
                  <Icon size={17} />
                </span>
                <span className="cap-body">
                  <span className="cap-label">
                    {c.label}
                    <ArrowUpRight size={13} className="cap-arrow" />
                  </span>
                  <span className="cap-desc">{c.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
