/**
 * Soft-nav fallback for the @conversation slot. Reuses the loading
 * skeleton so the column keeps its dimensions when other slots
 * navigate.
 */
import ConversationLoading from './loading';

export default function ConversationDefault() {
  return <ConversationLoading />;
}
