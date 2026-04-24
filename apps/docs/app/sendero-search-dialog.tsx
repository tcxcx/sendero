'use client';

import { useEffect, useState } from 'react';
import type { SearchLink } from 'fumadocs-ui/components/dialog/search';
import { SearchDialog } from 'fumadocs-ui/components/dialog/search';

type SearchHit = {
  id: string;
  type: 'page' | 'heading' | 'text';
  content: string;
  url: string;
};

/**
 * Fumadocs' default search client (`useDocsSearch` + `useOnChange`) can leave
 * `results` stuck on the sentinel `"empty"` when the fetch fails, which hides
 * the entire results region (blank modal below the input). We call `/api/search`
 * directly with explicit error handling so the UI always reflects loaded / empty.
 */
export default function SenderoSearchDialog({
  open,
  onOpenChange,
  links = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links?: SearchLink[];
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchHit[] | 'empty'>('empty');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setResults('empty');
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setDebounced(search.trim()), 120);
    return () => window.clearTimeout(id);
  }, [search, open]);

  useEffect(() => {
    if (!open) return;
    if (debounced.length === 0) {
      setResults('empty');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const url = new URL('/api/search', window.location.origin);
    url.searchParams.set('query', debounced);

    fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<SearchHit[]>;
      })
      .then(json => {
        if (cancelled) return;
        setResults(Array.isArray(json) ? json : []);
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      links={links}
      search={search}
      onSearchChange={setSearch}
      isLoading={loading}
      results={results}
    />
  );
}
