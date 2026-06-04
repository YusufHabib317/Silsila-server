import { describe, expect, it } from "bun:test";

import {
  handleBaileysIncomingMessage,
  normalizeBaileysIncomingMessage,
} from "../src/modules/whatsapp/whatsapp.baileys.ts";
import type { IngestWhatsappMessageInput } from "../src/modules/whatsapp/whatsapp.schemas.ts";

const ids = {
  tenant: "00000000-0000-4000-8000-000000000001",
  account: "00000000-0000-4000-8000-000000000010",
  message: "00000000-0000-4000-8000-000000000020",
} as const;

describe("Baileys incoming message handler", () => {
  it("normalizes group text messages into ingestion input", () => {
    const normalizedMessage = normalizeBaileysIncomingMessage({
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      chatDisplayName: "Retail Group",
      chatSourceType: "merchant_group",
      ingestedAt: date("2026-01-01T00:00:05.000Z"),
      message: {
        key: {
          id: "BAILEYS-MSG-1",
          remoteJid: "retail-group@g.us",
          participant: "963111111111@s.whatsapp.net",
          fromMe: false,
        },
        pushName: "Sender A",
        messageTimestamp: 1767225600,
        message: {
          conversation: "Red shoes price 100",
        },
      },
    });

    expect(normalizedMessage).not.toBeNull();
    expect(normalizedMessage?.whatsappAccountId).toBe(ids.account);
    expect(normalizedMessage?.externalMessageId).toBe("BAILEYS-MSG-1");
    expect(normalizedMessage?.chat).toEqual({
      externalChatId: "retail-group@g.us",
      displayName: "Retail Group",
      sourceType: "merchant_group",
    });
    expect(normalizedMessage?.sender).toEqual({
      externalContactId: "963111111111@s.whatsapp.net",
      phoneNumber: "+963111111111",
      displayName: "Sender A",
    });
    expect(normalizedMessage?.messageType).toBe("text");
    expect(normalizedMessage?.bodyText).toBe("Red shoes price 100");
    expect(normalizedMessage?.isFromMe).toBe(false);
    expect(normalizedMessage?.receivedAt.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("maps media variants and stores a JSON-safe raw payload", () => {
    const normalizedMessage = normalizeBaileysIncomingMessage({
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      ingestedAt: date("2026-01-01T01:00:00.000Z"),
      message: {
        key: {
          id: "BAILEYS-MSG-2",
          remoteJid: "customer-1@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: {
          low: 1767229200,
        },
        message: {
          ephemeralMessage: {
            message: {
              imageMessage: {
                caption: "Blue bag photo",
                jpegThumbnail: new Uint8Array([1, 2, 3]),
                mediaKeyTimestamp: 123n,
              },
            },
          },
        },
      },
    });

    expect(normalizedMessage).not.toBeNull();
    expect(normalizedMessage?.messageType).toBe("image");
    expect(normalizedMessage?.bodyText).toBe("Blue bag photo");
    expect(normalizedMessage?.receivedAt.toISOString()).toBe(
      "2026-01-01T01:00:00.000Z",
    );
    expect(normalizedMessage?.rawPayloadJson).toEqual({
      key: {
        id: "BAILEYS-MSG-2",
        remoteJid: "customer-1@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: {
        low: 1767229200,
      },
      message: {
        ephemeralMessage: {
          message: {
            imageMessage: {
              caption: "Blue bag photo",
              jpegThumbnail: {
                type: "binary",
                byteLength: 3,
              },
              mediaKeyTimestamp: "123",
            },
          },
        },
      },
    });
  });

  it("ignores status broadcasts and payloads without user message content", () => {
    const statusBroadcast = normalizeBaileysIncomingMessage({
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      message: {
        key: {
          id: "STATUS-MSG",
          remoteJid: "status@broadcast",
          fromMe: false,
        },
        message: {
          conversation: "status",
        },
      },
    });
    expect(statusBroadcast).toBeNull();

    const protocolOnly = normalizeBaileysIncomingMessage({
      tenantId: ids.tenant,
      whatsappAccountId: ids.account,
      message: {
        key: {
          id: "NO-CONTENT",
          remoteJid: "customer-1@s.whatsapp.net",
        },
      },
    });
    expect(protocolOnly).toBeNull();
  });

  it("passes normalized messages to the ingestion service", async () => {
    const calls: Array<{
      tenantId: string;
      input: IngestWhatsappMessageInput;
    }> = [];

    const result = await handleBaileysIncomingMessage(
      {
        tenantId: ids.tenant,
        whatsappAccountId: ids.account,
        ingestedAt: date("2026-01-01T02:00:00.000Z"),
        message: {
          key: {
            id: "BAILEYS-MSG-3",
            remoteJid: "customer-2@s.whatsapp.net",
            fromMe: true,
          },
          messageTimestamp: "2026-01-01T02:00:00.000Z",
          message: {
            audioMessage: {
              ptt: true,
            },
          },
        },
      },
      {
        ingestMessage: async (tenantId, input) => {
          calls.push({ tenantId, input });

          return {
            tenantId,
            whatsappAccountId: input.whatsappAccountId,
            chatId: "00000000-0000-4000-8000-000000000030",
            senderContactId: null,
            messageId: ids.message,
            externalMessageId: input.externalMessageId,
            expiresAt: date("2026-01-02T02:00:00.000Z"),
            wasCreated: true,
          };
        },
      },
    );

    expect(result?.messageId).toBe(ids.message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenantId).toBe(ids.tenant);
    expect(calls[0]?.input.messageType).toBe("voice");
    expect(calls[0]?.input.sender).toBeNull();
    expect(calls[0]?.input.isFromMe).toBe(true);
  });
});

function date(value: string): Date {
  return new Date(value);
}
