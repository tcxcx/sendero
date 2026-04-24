'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export function SenderoSSOCallback() {
  return (
    <AuthenticateWithRedirectCallback
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      firstFactorUrl="/sign-in/factor-one"
      secondFactorUrl="/sign-in/factor-two"
      resetPasswordUrl="/sign-in/reset-password"
      continueSignUpUrl="/sign-up/continue"
      verifyEmailAddressUrl="/sign-up/verify-email-address"
      verifyPhoneNumberUrl="/sign-up/verify-phone-number"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
    />
  );
}
