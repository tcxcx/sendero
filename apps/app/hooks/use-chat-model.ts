'use client';

/**
 * Shared, persisted chat-model preference.
 *
 * Reads/writes localStorage under `sendero.chat.model`. Cross-component
 * sync via the `storage` event (other tabs) and a custom event
 * `sendero:chat-model-changed` (same tab). Two surfaces — `/dashboard/console`
 * and `/dashboard/agent-chat` — both use this hook so the operator's pick
 * applies wherever they chat next.
 *
 * Scope is intentionally narrow: only the **conversational LLM** for
 * `/api/chat` and `/api/agent/chat`. Tool-internal models (OCR via
 * Gemini Vision, embedding models, etc.) are NOT routed through this
 * preference — those stay pinned in their respective handlers.
 */

import { useCallback, useEffect, useState } from 'react';

export const CHAT_MODEL_STORAGE_KEY = 'sendero.chat.model';
export const CHAT_MODEL_DEFAULT = 'google/gemini-2.5-flash';

const CHANGE_EVENT = 'sendero:chat-model-changed';

interface ChatModelChangedDetail {
  model: string;
}

export function useChatModel(): readonly [string, (id: string) => void] {
  const [model, setModelState] = useState<string>(CHAT_MODEL_DEFAULT);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
    if (stored) setModelState(stored);

    const onStorage = (e: StorageEvent) => {
      if (e.key === CHAT_MODEL_STORAGE_KEY && e.newValue) setModelState(e.newValue);
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<ChatModelChangedDetail>).detail;
      if (detail?.model) setModelState(detail.model);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, onCustom as EventListener);
    };
  }, []);

  const setModel = useCallback((id: string) => {
    setModelState(id);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, id);
    window.dispatchEvent(
      new CustomEvent<ChatModelChangedDetail>(CHANGE_EVENT, { detail: { model: id } })
    );
  }, []);

  return [model, setModel] as const;
}
