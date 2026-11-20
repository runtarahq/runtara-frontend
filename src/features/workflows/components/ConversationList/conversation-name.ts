import type { ConversationSummary } from '@/generated/RuntaraRuntimeApi';

/** What a conversation is called in the list: its title, or the last thing
 * said in it, or its key. */
export function conversationName(conversation: ConversationSummary): string {
  return (
    conversation.title?.trim() ||
    conversation.lastSaid?.text?.trim() ||
    conversation.key
  );
}
