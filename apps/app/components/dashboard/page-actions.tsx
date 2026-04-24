'use client';

import { useEffect, type ReactNode } from 'react';

import { usePageHeaderStore } from './page-header-store';

/**
 * Declarative slot into the shared `DashboardPageHeader` action row.
 *
 * Any dashboard page can drop `<PageActions>{…}</PageActions>` into
 * its JSX and the children land to the right of the pathname-derived
 * title + description in the chrome. Unmount clears the slot so the
 * next page starts blank.
 *
 *   export default function SpendPage() {
 *     return (
 *       <>
 *         <PageActions>
 *           <Button onClick={…}>Export CSV</Button>
 *         </PageActions>
 *         <SpendBody />
 *       </>
 *     );
 *   }
 *
 * Renders nothing directly — only publishes to the page-header store.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const setActions = usePageHeaderStore(s => s.setActions);

  useEffect(() => {
    setActions(children);
    return () => setActions(null);
  }, [children, setActions]);

  return null;
}
