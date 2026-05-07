import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <SignIn
        path="/sign-in"
        signUpUrl="/sign-in"
        fallbackRedirectUrl="/dashboard/treasury"
      />
    </div>
  );
}
