'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Download, Copy, Check, Image } from 'lucide-react';

interface MermaidExportProps {
  mermaidCode: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function MermaidExport({ mermaidCode, containerRef }: MermaidExportProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mermaidCode);
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 1200);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = mermaidCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 1200);
    }
  }, [mermaidCode]);

  const handleDownloadSvg = useCallback(() => {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [containerRef]);

  if (!mermaidCode) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-lg transition-colors cursor-pointer"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
        }}
        title="Export diagram"
      >
        <Download size={16} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-40 rounded-lg overflow-hidden z-20"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <button
            onClick={handleCopyCode}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:opacity-80 cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            {copied ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          <button
            onClick={handleDownloadSvg}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:opacity-80 cursor-pointer"
            style={{
              color: 'var(--text-secondary)',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <Image size={14} />
            Download SVG
          </button>
        </div>
      )}
    </div>
  );
}
