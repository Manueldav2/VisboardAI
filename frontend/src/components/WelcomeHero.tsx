'use client';

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  Mic, Square, Brain, Network, Blocks, Swords, Globe, Zap, History,
} from 'lucide-react';

gsap.registerPlugin(useGSAP);

type RTStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  realtimeStatus: RTStatus;
  aiStatus: AIStatus;
  isMobile: boolean;
  onMic: () => void;
  onQuickAction: (prompt: string) => void;
  onPastChats?: () => void;
}

const CAPS = [
  { icon: Brain, label: 'Quiz me', prompt: 'Quiz me on something', color: 'var(--blue)' },
  { icon: Network, label: 'Map a concept', prompt: 'Help me map out a concept', color: 'var(--accent)' },
  { icon: Blocks, label: 'Plan an app', prompt: 'Help me plan a software project', color: 'var(--teal)' },
  { icon: Swords, label: 'Debate practice', prompt: "Let's practice debate", color: 'var(--red)' },
  { icon: Globe, label: 'Practice a language', prompt: 'Help me practice a language', color: 'var(--green)' },
  { icon: Zap, label: 'Cram a topic', prompt: 'Help me cram a topic fast', color: 'var(--violet)' },
];

const TRY_LINES = [
  'Explain the Krebs cycle like I’m five',
  'Quiz me on nursing pharmacology',
  'Plan a food-delivery app with me',
  'Map out how neural networks learn',
];

function computeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

export function WelcomeHero({ realtimeStatus, aiStatus, isMobile, onMic, onQuickAction, onPastChats }: Props) {
  const connected = realtimeStatus === 'connected';
  const connecting = realtimeStatus === 'connecting';
  const scope = useRef<HTMLDivElement>(null);

  // Compute on the client only to avoid a static-export hydration mismatch.
  const [greeting, setGreeting] = useState('Welcome back');
  const [tryLine, setTryLine] = useState(TRY_LINES[0]);
  useEffect(() => {
    setGreeting(computeGreeting());
    setTryLine(TRY_LINES[Math.floor(Math.random() * TRY_LINES.length)]);
  }, []);

  useGSAP(() => {
    gsap.from('.reveal', {
      y: 16, autoAlpha: 0, duration: 0.55, ease: 'power3.out', stagger: 0.06,
    });
  }, { scope });

  const status = connected
    ? (aiStatus === 'listening' ? 'Listening — think out loud.'
      : aiStatus === 'thinking' ? 'One moment…'
      : aiStatus === 'speaking' ? 'Speaking…'
      : 'Connected — I’m all ears.')
    : connecting ? 'Connecting…'
    : 'What do you want to think through?';

  return (
    <div ref={scope} className="welcome-hero relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-5">
      <div className="hero-glow" aria-hidden />

      <div className="relative z-10 flex w-full max-w-[680px] flex-col items-center text-center">
        <h1 className="greeting reveal">
          {greeting}<span className="greeting-dot">.</span>
        </h1>
        <p className="greeting-sub reveal">{status}</p>

        {/* Secondary actions */}
        <div className="pill-row reveal">
          <button
            onClick={onMic}
            className={`mini-pill ${connected ? 'is-stop' : 'is-primary'}`}
          >
            {connected ? <Square size={13} /> : <Mic size={13} />}
            {connecting ? 'Connecting…' : connected ? 'Stop' : 'Talk to Gideon'}
          </button>
          {onPastChats && (
            <button onClick={onPastChats} className="mini-pill">
              <History size={13} />
              Past chats
            </button>
          )}
        </div>

        {/* Capability pills */}
        <div className="cap-pills reveal">
          {CAPS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.label}
                onClick={() => onQuickAction(c.prompt)}
                className="cap-pill"
                style={{ ['--pill-accent' as string]: c.color }}
              >
                <Icon size={15} className="cap-pill-icon" />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        {!isMobile && (
          <p className="try-line reveal">
            Try <button className="try-btn" onClick={() => onQuickAction(tryLine)}>&ldquo;{tryLine}&rdquo;</button>
          </p>
        )}
      </div>
    </div>
  );
}
