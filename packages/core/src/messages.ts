// Remembers each chat's latest real inbound message (from OpenClaw's
// message_received hook), so quotes can be checked against what the user
// actually sent rather than the model's copy. A message is trusted for two
// minutes: chats that share a session (dashboard and WhatsApp DMs) could
// otherwise check a new message against an old one.
export const MESSAGE_FRESH_MS = 2 * 60 * 1000;

export type MessageLog = {
  record(sessionKey: string, content: string): void;
  latest(sessionKey: string): string | undefined;
};

export function createMessageLog(now: () => number = Date.now): MessageLog {
  const messages = new Map<string, { content: string; at: number }>();
  return {
    record(sessionKey, content) {
      messages.set(sessionKey, { content, at: now() });
    },
    latest(sessionKey) {
      const message = messages.get(sessionKey);
      if (!message) return undefined;
      if (now() - message.at > MESSAGE_FRESH_MS) {
        messages.delete(sessionKey);
        return undefined;
      }
      return message.content;
    },
  };
}
