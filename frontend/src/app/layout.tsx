import './globals.css';
import type { Metadata, Viewport } from 'next';
import AppShell from './AppShell';

const TITLE = 'Gideon — A Place to Map Your Thoughts';
const DESCRIPTION =
  'A place to map your thoughts. Quiz, debate, plan, and explore — all through conversation with your AI study companion.';

export const metadata: Metadata = {
  // Resolves OG/Twitter image URLs to the real site instead of localhost:3000.
  metadataBase: new URL('https://visboardai.com'),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Gideon',
  icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'Gideon',
    url: 'https://visboardai.com',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Gideon — Map Your Thoughts' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
