import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { and, eq } from "drizzle-orm";

import { getDatabase } from "../../db/client.ts";
import { whatsappAuthStates } from "../../db/schema.ts";
import { decryptText, encryptText } from "../../lib/encryption.ts";

const credsKeyType = "creds";
const credsKeyId = "creds";

type DatabaseBaileysAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
};

type AuthStoreScope = {
  tenantId: string;
  whatsappAccountId: string;
};

function buildAad(scope: AuthStoreScope, keyType: string, keyId: string): string {
  return [
    "baileys-auth",
    scope.tenantId,
    scope.whatsappAccountId,
    keyType,
    keyId,
  ].join(":");
}

function serializeAuthValue(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserializeAuthValue<TValue>(value: string): TValue {
  return JSON.parse(value, BufferJSON.reviver) as TValue;
}

async function readAuthValue<TValue>(
  scope: AuthStoreScope,
  keyType: string,
  keyId: string,
): Promise<TValue | null> {
  const db = getDatabase();
  const rows = await db
    .select({ encryptedPayload: whatsappAuthStates.encryptedPayload })
    .from(whatsappAuthStates)
    .where(
      and(
        eq(whatsappAuthStates.tenantId, scope.tenantId),
        eq(whatsappAuthStates.whatsappAccountId, scope.whatsappAccountId),
        eq(whatsappAuthStates.keyType, keyType),
        eq(whatsappAuthStates.keyId, keyId),
      ),
    )
    .limit(1);
  const encryptedPayload = rows[0]?.encryptedPayload;

  if (!encryptedPayload) {
    return null;
  }

  const serializedValue = decryptText(
    encryptedPayload,
    buildAad(scope, keyType, keyId),
  );

  return deserializeAuthValue<TValue>(serializedValue);
}

async function writeAuthValue(
  scope: AuthStoreScope,
  keyType: string,
  keyId: string,
  value: unknown,
): Promise<void> {
  const db = getDatabase();
  const updatedAt = new Date();
  const encryptedPayload = encryptText(
    serializeAuthValue(value),
    buildAad(scope, keyType, keyId),
  );

  await db
    .insert(whatsappAuthStates)
    .values({
      tenantId: scope.tenantId,
      whatsappAccountId: scope.whatsappAccountId,
      keyType,
      keyId,
      encryptedPayload,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        whatsappAuthStates.tenantId,
        whatsappAuthStates.whatsappAccountId,
        whatsappAuthStates.keyType,
        whatsappAuthStates.keyId,
      ],
      set: {
        encryptedPayload,
        updatedAt,
      },
    });
}

async function removeAuthValue(
  scope: AuthStoreScope,
  keyType: string,
  keyId: string,
): Promise<void> {
  const db = getDatabase();

  await db
    .delete(whatsappAuthStates)
    .where(
      and(
        eq(whatsappAuthStates.tenantId, scope.tenantId),
        eq(whatsappAuthStates.whatsappAccountId, scope.whatsappAccountId),
        eq(whatsappAuthStates.keyType, keyType),
        eq(whatsappAuthStates.keyId, keyId),
      ),
    );
}

export async function clearDatabaseBaileysAuthState(
  tenantId: string,
  whatsappAccountId: string,
): Promise<void> {
  const db = getDatabase();

  await db
    .delete(whatsappAuthStates)
    .where(
      and(
        eq(whatsappAuthStates.tenantId, tenantId),
        eq(whatsappAuthStates.whatsappAccountId, whatsappAccountId),
      ),
    );
}

export async function useDatabaseBaileysAuthState(
  tenantId: string,
  whatsappAccountId: string,
): Promise<DatabaseBaileysAuthState> {
  const scope = {
    tenantId,
    whatsappAccountId,
  };
  const creds =
    (await readAuthValue<AuthenticationCreds>(
      scope,
      credsKeyType,
      credsKeyId,
    )) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <TKeyType extends keyof SignalDataTypeMap>(
          keyType: TKeyType,
          keyIds: string[],
        ) => {
          const values: Partial<Record<string, SignalDataTypeMap[TKeyType]>> =
            {};

          await Promise.all(
            keyIds.map(async (keyId) => {
              let value = await readAuthValue<SignalDataTypeMap[TKeyType]>(
                scope,
                keyType,
                keyId,
              );

              if (keyType === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as unknown as Record<string, unknown>,
                ) as unknown as SignalDataTypeMap[TKeyType];
              }

              if (value) {
                values[keyId] = value;
              }
            }),
          );

          return values as Record<string, SignalDataTypeMap[TKeyType]>;
        },
        set: async (data: SignalDataSet) => {
          const tasks: Array<Promise<void>> = [];

          for (const keyType of Object.keys(data) as Array<
            keyof SignalDataSet
          >) {
            const keyValues = data[keyType];

            if (!keyValues) {
              continue;
            }

            for (const keyId of Object.keys(keyValues)) {
              const value = keyValues[keyId];

              tasks.push(
                value
                  ? writeAuthValue(scope, keyType, keyId, value)
                  : removeAuthValue(scope, keyType, keyId),
              );
            }
          }

          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeAuthValue(scope, credsKeyType, credsKeyId, creds);
    },
  };
}
