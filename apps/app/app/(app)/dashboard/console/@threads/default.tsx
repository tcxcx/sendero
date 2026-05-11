/**
 * Soft-nav fallback for the @threads slot. Reuses the loading skeleton
 * so the rail column keeps its width when the operator navigates within
 * the dashboard tree but happens to skip the @threads segment.
 */
import ThreadsLoading from './loading';

export default function ThreadsDefault() {
  return <ThreadsLoading />;
}
