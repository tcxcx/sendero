'use client';

/**
 * MorphingDialog — shared-layout dialog primitive for the marketing
 * site. Trigger and content share a `layoutId`, so the trigger card
 * morphs into the dialog and back out on dismiss instead of cutting
 * to a modal.
 *
 * Adapted from midday-ai/midday `apps/website/src/components/motion-primitives/morphing-dialog.tsx`,
 * rebranded for Sendero's warm scrim (matches the platform's vermillion-
 * tinted overlay used in the operator console). Same component API
 * surface — drop-in replacement.
 *
 * Why this lives in apps/marketing rather than packages/ui: the
 * primitive depends on `motion`, which only the marketing app has as
 * a runtime dependency. If a second consumer needs it, lift to
 * `packages/ui/src/motion/` and add motion as a peer dep.
 */

import { X } from 'lucide-react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Transition,
  type Variant,
} from 'motion/react';
import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import useClickOutside from '../agents/use-click-outside';

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type Ctx = {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  uniqueId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const MorphingDialogContext = React.createContext<Ctx | null>(null);

function useMorphingDialog(): Ctx {
  const ctx = useContext(MorphingDialogContext);
  if (!ctx) throw new Error('MorphingDialog primitives must render inside <MorphingDialog>');
  return ctx;
}

const DEFAULT_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 200,
  damping: 24,
};

export type MorphingDialogProps = {
  children: React.ReactNode;
  transition?: Transition;
};

export function MorphingDialog({ children, transition }: MorphingDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const uniqueId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const value = useMemo<Ctx>(
    () => ({ isOpen, setIsOpen, uniqueId, triggerRef }),
    [isOpen, uniqueId]
  );

  return (
    <MorphingDialogContext.Provider value={value}>
      <MotionConfig transition={transition ?? DEFAULT_TRANSITION}>{children}</MotionConfig>
    </MorphingDialogContext.Provider>
  );
}

export type MorphingDialogTriggerProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogTrigger({ children, className, style }: MorphingDialogTriggerProps) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog();

  const onClick = useCallback(() => setIsOpen((v) => !v), [setIsOpen]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setIsOpen((v) => !v);
      }
    },
    [setIsOpen]
  );

  return (
    <motion.button
      ref={triggerRef}
      layoutId={`dialog-${uniqueId}`}
      className={cn('relative cursor-pointer', className)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={style}
      layout
      transition={DEFAULT_TRANSITION}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={`morphing-dialog-content-${uniqueId}`}
    >
      {children}
    </motion.button>
  );
}

export type MorphingDialogContentProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogContent({
  children,
  className,
  style,
}: MorphingDialogContentProps) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog();
  const containerRef = useRef<HTMLDivElement>(null);
  const [firstFocusable, setFirstFocusable] = useState<HTMLElement | null>(null);
  const [lastFocusable, setLastFocusable] = useState<HTMLElement | null>(null);

  // Escape closes; Tab traps focus within the dialog while open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      if (!firstFocusable || !lastFocusable) return;
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setIsOpen, firstFocusable, lastFocusable]);

  // Body scroll lock + focus management on open/close.
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('overflow-hidden');
      const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables && focusables.length > 0) {
        setFirstFocusable(focusables[0] ?? null);
        setLastFocusable(focusables[focusables.length - 1] ?? null);
        focusables[0]?.focus();
      }
    } else {
      document.body.classList.remove('overflow-hidden');
      triggerRef.current?.focus();
    }
  }, [isOpen, triggerRef]);

  useClickOutside(containerRef as React.RefObject<HTMLDivElement>, () => {
    if (isOpen) setIsOpen(false);
  });

  return (
    <motion.div
      ref={containerRef}
      layoutId={`dialog-${uniqueId}`}
      id={`morphing-dialog-content-${uniqueId}`}
      className={cn('relative overflow-hidden', className)}
      style={style}
      layout
      transition={DEFAULT_TRANSITION}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogContainerProps = {
  children: React.ReactNode;
};

export function MorphingDialogContainer({ children }: MorphingDialogContainerProps) {
  const { isOpen, uniqueId } = useMorphingDialog();
  const [mounted, setMounted] = useState(false);

  // Portal target only exists client-side; render nothing during SSR.
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence initial={false} mode="sync">
      {isOpen && (
        <>
          {/*
            Sendero scrim — vermillion-tinted parchment in light mode,
            ink-dominated in dark mode. Matches the dialog overlay used
            inside the operator console (apps/app/components/ui/dialog.tsx).
          */}
          <motion.div
            key={`backdrop-${uniqueId}`}
            className="fixed inset-0 z-[9999] backdrop-blur-sm"
            style={{
              height: '100dvh',
              background:
                'color-mix(in oklab, var(--ink, #1f2a44) 70%, color-mix(in oklab, var(--vermillion, #fb542b) 12%, transparent))',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.85 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center">{children}</div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

export type MorphingDialogTitleProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogTitle({ children, className, style }: MorphingDialogTitleProps) {
  const { uniqueId } = useMorphingDialog();
  return (
    <motion.div
      layoutId={`dialog-title-container-${uniqueId}`}
      className={className}
      style={style}
      layout
      transition={DEFAULT_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogSubtitleProps = MorphingDialogTitleProps;

export function MorphingDialogSubtitle({
  children,
  className,
  style,
}: MorphingDialogSubtitleProps) {
  const { uniqueId } = useMorphingDialog();
  return (
    <motion.div
      layoutId={`dialog-subtitle-container-${uniqueId}`}
      className={className}
      style={style}
      layout
      transition={DEFAULT_TRANSITION}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogDescriptionProps = {
  children: React.ReactNode;
  className?: string;
  disableLayoutAnimation?: boolean;
  variants?: { initial: Variant; animate: Variant; exit: Variant };
};

export function MorphingDialogDescription({
  children,
  className,
  variants,
  disableLayoutAnimation,
}: MorphingDialogDescriptionProps) {
  const { uniqueId } = useMorphingDialog();
  return (
    <motion.div
      key={`dialog-description-${uniqueId}`}
      layoutId={
        disableLayoutAnimation ? undefined : `dialog-description-content-${uniqueId}`
      }
      variants={variants}
      className={className}
      initial="initial"
      animate="animate"
      exit="exit"
      id={`dialog-description-${uniqueId}`}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogImageProps = {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogImage({ src, alt, className, style }: MorphingDialogImageProps) {
  const { uniqueId } = useMorphingDialog();
  return (
    <motion.img
      src={src}
      alt={alt}
      className={className}
      layoutId={`dialog-img-${uniqueId}`}
      style={style}
    />
  );
}

export type MorphingDialogCloseProps = {
  children?: React.ReactNode;
  className?: string;
  variants?: { initial: Variant; animate: Variant; exit: Variant };
};

export function MorphingDialogClose({ children, className, variants }: MorphingDialogCloseProps) {
  const { setIsOpen } = useMorphingDialog();
  const handleClose = useCallback(() => setIsOpen(false), [setIsOpen]);

  const buttonContent = children ?? <X className="h-6 w-6 text-[var(--ink,#1f2a44)]" />;

  // Plain button, never motion.button — variants on the wrapper avoid
  // the layout-animation-fights-exit-transition footgun.
  const button = (
    <button
      onClick={handleClose}
      type="button"
      aria-label="Close dialog"
      className={cn('focus:outline-none', className)}
      style={{
        position: 'absolute',
        top: '1.5rem',
        right: '1.5rem',
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      {buttonContent}
    </button>
  );

  if (!variants) return button;

  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
      layout={false}
      style={{
        position: 'absolute',
        top: '1.5rem',
        right: '1.5rem',
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      {button}
    </motion.div>
  );
}
