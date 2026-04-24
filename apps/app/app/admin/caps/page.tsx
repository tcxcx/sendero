import { permanentRedirect } from 'next/navigation';

export default function LegacyCapsPage() {
  permanentRedirect('/dashboard/caps');
}
