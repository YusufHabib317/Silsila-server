import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { env } from "../config/env.ts";

const algorithm = "aes-256-gcm";
const ivByteLength = 12;
const localDevelopmentSecret = "wa-commerce-local-development-encryption-key";

type EncryptedPayload = {
  v: 1;
  alg: typeof algorithm;
  iv: string;
  tag: string;
  data: string;
};

function getEncryptionSecret(): string {
  if (env.ENCRYPTION_KEY) {
    return env.ENCRYPTION_KEY;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is required in production.");
  }

  return localDevelopmentSecret;
}

function getEncryptionKey(): Buffer {
  return createHash("sha256").update(getEncryptionSecret()).digest();
}

function aadToBuffer(aad: string | undefined): Buffer | undefined {
  return aad ? Buffer.from(aad, "utf8") : undefined;
}

export function encryptText(plainText: string, aad?: string): string {
  const iv = randomBytes(ivByteLength);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const aadBuffer = aadToBuffer(aad);

  if (aadBuffer) {
    cipher.setAAD(aadBuffer);
  }

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const payload: EncryptedPayload = {
    v: 1,
    alg: algorithm,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptText(encryptedText: string, aad?: string): string {
  const payload = JSON.parse(encryptedText) as EncryptedPayload;

  if (payload.v !== 1 || payload.alg !== algorithm) {
    throw new Error("Unsupported encrypted payload format.");
  }

  const decipher = createDecipheriv(
    algorithm,
    getEncryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );
  const aadBuffer = aadToBuffer(aad);

  if (aadBuffer) {
    decipher.setAAD(aadBuffer);
  }

  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
