import "server-only";
import type { ChatSender } from "@/lib/chat/handle";
import type { ChatChannel } from "@/lib/conversations";
import { sendWhatsAppText } from "@/lib/whatsapp";

/** Versandweg je Kanal; der Test-Chat im Cockpit verschickt nichts nach außen. */
export function senderFor(channel: ChatChannel): ChatSender {
  return channel === "whatsapp" ? (conversation, text) => sendWhatsAppText(conversation.contact, text) : async () => null;
}
