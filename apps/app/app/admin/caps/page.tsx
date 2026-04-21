import { permanentRedirect } from 'next/navigation';

export default function LegacyCapsPage() {
  permanentRedirect('/app/caps');
}
