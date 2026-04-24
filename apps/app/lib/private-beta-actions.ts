'use server';

import { redirect } from 'next/navigation';
import { clerkClient } from '@clerk/nextjs/server';

import {
  isPrivateBetaEmailIdentifier,
  isBetaOpen,
  isPrivateBetaWhitelisted,
  normalizePrivateBetaIdentifier,
  setPrivateBetaAccessCookie,
} from '@/lib/private-beta';

export async function submitPrivateBetaAccess(formData: FormData) {
  const identifier = String(formData.get('identifier') ?? '');
  const returnTo = safeAuthReturnPath(String(formData.get('returnTo') ?? '/sign-in'));

  if (isBetaOpen() || isPrivateBetaWhitelisted(identifier)) {
    await setPrivateBetaAccessCookie(identifier);
    redirect(returnTo);
  }

  await createClerkWaitlistEntry(identifier);
  redirect(withBetaWaitlist(returnTo));
}

async function createClerkWaitlistEntry(identifier: string) {
  if (!isPrivateBetaEmailIdentifier(identifier)) return;

  const emailAddress = normalizePrivateBetaIdentifier(identifier);
  if (!emailAddress) return;

  try {
    const client = await clerkClient();
    await client.waitlistEntries.create({
      emailAddress,
      notify: false,
    });
  } catch (error) {
    console.warn(
      '[private-beta] Failed to create Clerk waitlist entry',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function safeAuthReturnPath(raw: string): string {
  try {
    const url = new URL(raw, 'https://sendero.local');
    if (url.pathname !== '/sign-in' && url.pathname !== '/sign-up') return '/sign-in';
    url.searchParams.delete('beta');
    const redirectUrl = url.searchParams.get('redirect_url');
    if (redirectUrl && !isSafeRedirectUrl(redirectUrl)) {
      url.searchParams.delete('redirect_url');
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '/sign-in';
  }
}

function isSafeRedirectUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;

  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.endsWith('.sendero.travel') ||
      url.hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

function withBetaWaitlist(path: string): string {
  const url = new URL(path, 'https://sendero.local');
  url.searchParams.set('beta', 'waitlist');
  return `${url.pathname}${url.search}`;
}
