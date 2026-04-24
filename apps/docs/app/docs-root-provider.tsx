'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider';

const SenderoSearchDialog = dynamic(() => import('./sendero-search-dialog'), { ssr: false });

export function DocsRootProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{
        SearchDialog: SenderoSearchDialog,
      }}
    >
      {children}
    </RootProvider>
  );
}
