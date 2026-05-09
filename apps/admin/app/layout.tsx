import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import Script from 'next/script';

import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sendero Admin',
  description: 'Sendero platform admin — treasury, contracts, payouts',
  robots: { index: false, follow: false },
};

const enableReactGrab =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ENABLE_REACT_GRAB !== '0';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          {enableReactGrab && (
            <Script
              src="https://unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          )}
        </head>
        <body>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            defaultPlatformTheme="zen"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
