'use client';

import { useMemo, useState } from 'react';
import {
  getLocaleDisplayName,
  LOCALE_QUERY_PARAM,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from '@sendero/locale';

type LanguageSelectorProps = {
  currentLocale: string;
};

const OVERLAY_COPY: Record<string, { title: string; detail: string }> = {
  'en-US': {
    title: 'Switching language',
    detail: 'Reloading Sendero with your locale context.',
  },
  'es-AR': {
    title: 'Cambiando idioma',
    detail: 'Recargando Sendero con tu contexto local.',
  },
  'es-MX': {
    title: 'Cambiando idioma',
    detail: 'Recargando Sendero con tu contexto local.',
  },
  'pt-BR': {
    title: 'Trocando idioma',
    detail: 'Recarregando Sendero com seu contexto local.',
  },
};

export function LanguageSelector({ currentLocale }: LanguageSelectorProps) {
  const [isChanging, setIsChanging] = useState(false);
  const normalized = normalizeLocale(currentLocale) ?? 'en-US';
  const copy = OVERLAY_COPY[normalized] ?? OVERLAY_COPY['en-US'];

  const options = useMemo(
    () =>
      SUPPORTED_LOCALES.map(locale => ({
        locale,
        label: getLocaleDisplayName(locale),
      })),
    []
  );

  function changeLocale(nextLocale: string) {
    const next = normalizeLocale(nextLocale);
    if (!next || next === normalized) return;
    setIsChanging(true);

    const url = new URL(window.location.href);
    url.searchParams.set(LOCALE_QUERY_PARAM, next);
    window.location.assign(url.toString());
  }

  return (
    <>
      <label className="grid gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Language
        </span>
        <select
          aria-label="Language"
          className="h-10 min-w-[12rem] border border-[var(--border)] bg-[var(--bg-elev)] px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text)] outline-none transition-colors hover:border-[var(--ink)] focus:border-[var(--ink)]"
          disabled={isChanging}
          onChange={event => changeLocale(event.target.value)}
          value={normalized}
        >
          {options.map(option => (
            <option key={option.locale} value={option.locale}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {isChanging ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-elev)] p-6 text-center shadow-[0_18px_60px_rgba(15,15,15,0.08)]">
            <div className="mx-auto mb-5 size-3 animate-pulse bg-[var(--ink)]" aria-hidden="true" />
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink)]">
              {copy.title}
            </p>
            <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-dim)]">{copy.detail}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
