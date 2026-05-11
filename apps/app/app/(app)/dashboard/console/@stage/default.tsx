/**
 * Soft-nav fallback for the @stage slot. Renders the live stage so the
 * column persists across in-app navigations. (Stage reads from
 * Zustand — no server fetch; mounting it as default is cheap.)
 */
import { ConsoleStage } from '@/components/console/console-stage';

export default function StageDefault() {
  return <ConsoleStage />;
}
