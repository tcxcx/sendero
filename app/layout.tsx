import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pasillo × Arc · AI Travel Agent',
  description:
    'B2B2C travel platform — partners plug in their corporate traveler base, every flight, hotel and ground leg is booked by an AI workflow and settled on Arc L2 in USDC or EURC.',
  applicationName: 'Pasillo × Arc',
  authors: [{ name: 'Pasillo' }],
  keywords: ['travel', 'AI agent', 'USDC', 'EURC', 'Circle', 'Arc', 'CCTP', 'B2B2C'],
};

export const viewport: Viewport = {
  width: 1400,
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Departure Mono as pixel display font — via raw <style> to match design */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @font-face {
                font-family: 'Departure Mono';
                src: url('https://cdn.jsdelivr.net/gh/zephsmith/departure-mono/DepartureMono-Regular.woff2') format('woff2');
                font-weight: 400;
                font-style: normal;
                font-display: swap;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
