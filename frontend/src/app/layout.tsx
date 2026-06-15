'use client';

import './globals.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  GraduationCap,
  Mic,
  Network,
  Blocks,
  Scale,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Menu,
  X,
} from 'lucide-react';
import { BlobCursor } from '@/components/ui/blob-cursor';
import { useIsMobile } from '@/lib/useIsMobile';

const navItems = [
  { href: '/', label: 'Gideon', icon: MessageSquare },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/classes', label: 'Classes', icon: GraduationCap },
  { href: '/study-buddy', label: 'Study Buddy', icon: Mic },
  { href: '/thought-plot', label: 'Thought Plot', icon: Network },
  { href: '/architect', label: 'Architect', icon: Blocks },
  { href: '/argument-ref', label: 'Argument Ref', icon: Scale },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <title>Gideon — A Place to Map Your Thoughts</title>
        <meta name="description" content="A place to map your thoughts. Quiz, debate, plan, and explore — all through conversation with your AI study companion." />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        {/* OpenGraph for link sharing */}
        <meta property="og:title" content="Gideon — A Place to Map Your Thoughts" />
        <meta property="og:description" content="A place to map your thoughts. Quiz, debate, plan, and explore — all through conversation with your AI study companion." />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Gideon" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Gideon — A Place to Map Your Thoughts" />
        <meta name="twitter:description" content="A place to map your thoughts. Quiz, debate, plan, and explore — all through conversation with your AI study companion." />
      </head>
      <body className="antialiased">
        <BlobCursor color="rgba(212, 166, 74, 0.05)" size={350} />
        <div className="flex min-h-screen">

          {/* Mobile top bar */}
          {isMobile && (
            <div
              className="fixed top-0 left-0 right-0 z-50 flex items-center h-12 px-3 gap-3"
              style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="flex items-center justify-center w-9 h-9 rounded-lg"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center justify-center w-7 h-7 rounded-md"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent), #b8923d)',
                    color: 'var(--bg)',
                  }}
                >
                  <Network size={13} strokeWidth={2.5} />
                </div>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Gideon
                </span>
              </div>
            </div>
          )}

          {/* Mobile sidebar overlay */}
          {isMobile && mobileMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
                onClick={() => setMobileMenuOpen(false)}
              />
              <aside
                className="sidebar fixed top-0 left-0 z-[70] h-screen w-64 flex flex-col animate-slide-right"
                style={{ animationDuration: '200ms' }}
              >
                {/* Header with close */}
                <div
                  className="flex items-center justify-between px-4 h-14"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex items-center justify-center w-8 h-8 rounded-lg"
                      style={{
                        background: 'linear-gradient(135deg, var(--accent), #b8923d)',
                        color: 'var(--bg)',
                      }}
                    >
                      <Network size={15} strokeWidth={2.5} />
                    </div>
                    <span className="text-base font-semibold heading-display" style={{ color: 'var(--text-primary)' }}>
                      Gideon
                    </span>
                  </div>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`sidebar-link ${isActive ? 'active' : ''}`}
                        style={{ minHeight: '44px' }}
                      >
                        <Icon size={19} className="flex-shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>

                {/* Version */}
                <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-2">
                    <Sparkles size={12} style={{ color: 'var(--accent)' }} />
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--text-faint)' }}>
                      v2.0 — AI Platform
                    </span>
                  </div>
                </div>
              </aside>
            </>
          )}

          {/* Desktop Sidebar */}
          {!isMobile && (
            <aside
              className={`sidebar fixed top-0 left-0 z-40 h-screen flex flex-col transition-all duration-300 ${
                collapsed ? 'w-[68px]' : 'w-60'
              }`}
            >
              {/* Logo */}
              <div
                className="flex items-center gap-3 px-4 h-16 relative"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 relative"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent), #b8923d)',
                    color: 'var(--bg)',
                    boxShadow: '0 2px 8px rgba(212, 166, 74, 0.25)',
                  }}
                >
                  <Network size={17} strokeWidth={2.5} />
                </div>
                {!collapsed && (
                  <span
                    className="text-lg whitespace-nowrap heading-display"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Gideon
                  </span>
                )}
              </div>

              {/* Nav links */}
              <nav className="flex-1 py-4 px-2 space-y-0.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === '/'
                      ? pathname === '/'
                      : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sidebar-link ${isActive ? 'active' : ''}`}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon size={19} className="flex-shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </nav>

              {/* Bottom section */}
              <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                {!collapsed && (
                  <div className="px-4 py-2 flex items-center gap-2">
                    <Sparkles size={12} style={{ color: 'var(--accent)' }} />
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--text-faint)' }}>
                      v2.0 — AI Platform
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="flex items-center justify-center w-full h-11 transition-colors cursor-pointer"
                  style={{ color: 'var(--text-faint)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                >
                  {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
              </div>
            </aside>
          )}

          {/* Main content */}
          <main
            className={`flex-1 transition-all duration-300 ${
              isMobile ? 'ml-0 pt-12' : collapsed ? 'ml-[68px]' : 'ml-60'
            }`}
          >
            <div className="min-h-screen">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
