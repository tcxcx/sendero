import { SenderoSignIn } from '@sendero/auth/components/sign-in';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <SenderoSignIn />
    </main>
  );
}
