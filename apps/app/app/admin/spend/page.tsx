import { permanentRedirect } from 'next/navigation';

export default function LegacySpendPage() {
  permanentRedirect('/app/spend');
}
