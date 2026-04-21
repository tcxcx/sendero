import type { Metadata, Viewport } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ClerkProvider } from '@clerk/nextjs';
import { ReactGrabLoader } from '@/components/react-grab-loader';
import '@sendero/ui/globals.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sendero × Arc · AI Travel Agent',
  description:
    'B2B2C travel platform — partners plug in their corporate traveler base, every flight, hotel and ground leg is booked by an AI workflow and settled on Arc L2 in USDC or EURC.',
  applicationName: 'Sendero × Arc',
  authors: [{ name: 'Sendero' }],
  keywords: ['travel', 'AI agent', 'USDC', 'EURC', 'Circle', 'Arc', 'CCTP', 'B2B2C'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ReactGrabLoader />
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" waitlistUrl="/waitlist">
          <NuqsAdapter>{children}</NuqsAdapter>
        </ClerkProvider>
      </body>
    </html>
  );
}
