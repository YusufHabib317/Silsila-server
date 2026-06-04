import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import { getDatabase, getNeonQueryClient } from "../../db/client.ts";
import {
  platformAdmins,
  sessions,
  tenantUsers,
  tenants,
  users,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import type { LoginInput, RegisterInput } from "./auth.schemas.ts";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./passwords.ts";

export const sessionCookieName = "wa_commerce_session";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

export type SafeUser = {
  id: string;
  email: string;
  displayName: string;
};

export type TenantMembership = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "manager" | "agent" | "viewer" | "accountant";
};

export type AuthSession = {
  token: string;
  expiresAt: Date;
};

export type AuthResult = {
  user: SafeUser;
  tenants: TenantMembership[];
  isPlatformAdmin: boolean;
  session: AuthSession;
};

export type CurrentUserResult = {
  user: SafeUser;
  tenants: TenantMembership[];
  isPlatformAdmin: boolean;
};

function createTenantSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const suffix = crypto.randomUUID().slice(0, 8);
  return `${base || "tenant"}-${suffix}`;
}

function createSessionExpiry(): Date {
  return new Date(Date.now() + sessionTtlMs);
}

async function createSession(userId: string): Promise<AuthSession> {
  const db = getDatabase();
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = createSessionExpiry();

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return {
    token,
    expiresAt,
  };
}

async function getTenantMemberships(userId: string): Promise<TenantMembership[]> {
  const db = getDatabase();

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      role: tenantUsers.role,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
    .where(
      and(
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.status, "active"),
        inArray(tenants.status, ["active", "trial"]),
        isNull(tenantUsers.deletedAt),
        isNull(tenants.deletedAt),
      ),
    );

  return rows;
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const db = getDatabase();

  const rows = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(
      and(
        eq(platformAdmins.userId, userId),
        isNull(platformAdmins.deletedAt),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function registerTenantOwner(
  input: RegisterInput,
): Promise<AuthResult> {
  const db = getDatabase();

  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (existingUsers.length > 0) {
    throw new AppError({
      code: "EMAIL_ALREADY_REGISTERED",
      message: "An account with this email already exists.",
      statusCode: 409,
    });
  }

  const passwordHash = await hashPassword(input.password);
  const tenantSlug = createTenantSlug(input.tenantName);
  const sqlClient = getNeonQueryClient();
  const userId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const tenantUserId = crypto.randomUUID();
  const auditLogId = crypto.randomUUID();

  await sqlClient.transaction((transaction) => [
    transaction`
      insert into users (id, email, password_hash, display_name)
      values (${userId}, ${input.email}, ${passwordHash}, ${input.displayName})
    `,
    transaction`
      insert into tenants (id, name, slug)
      values (${tenantId}, ${input.tenantName}, ${tenantSlug})
    `,
    transaction`
      insert into tenant_users (id, tenant_id, user_id, role)
      values (${tenantUserId}, ${tenantId}, ${userId}, 'owner')
    `,
    transaction`
      insert into audit_logs (
        id,
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      values (
        ${auditLogId},
        ${tenantId},
        ${userId},
        'auth.registered',
        'tenant',
        ${tenantId},
        ${JSON.stringify({ email: input.email })}::jsonb
      )
    `,
  ]);

  const session = await createSession(userId);

  return {
    user: {
      id: userId,
      email: input.email,
      displayName: input.displayName,
    },
    tenants: [
      {
        id: tenantId,
        name: input.tenantName,
        slug: tenantSlug,
        role: "owner",
      },
    ],
    isPlatformAdmin: false,
    session,
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const db = getDatabase();

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(
      and(
        eq(users.email, input.email),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  const user = userRows[0];
  const passwordMatches = user
    ? await verifyPassword(input.password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    throw new AppError({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
      statusCode: 401,
    });
  }

  const session = await createSession(user.id);
  const memberships = await getTenantMemberships(user.id);
  const platformAdmin = await isPlatformAdmin(user.id);

  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    tenants: memberships,
    isPlatformAdmin: platformAdmin,
    session,
  };
}

export async function getCurrentUserByToken(
  token: string | undefined,
): Promise<CurrentUserResult | null> {
  if (!token) {
    return null;
  }

  const db = getDatabase();
  const tokenHash = hashSessionToken(token);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  const user = rows[0];

  if (!user) {
    return null;
  }

  const memberships = await getTenantMemberships(user.id);
  const platformAdmin = await isPlatformAdmin(user.id);

  return {
    user,
    tenants: memberships,
    isPlatformAdmin: platformAdmin,
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) {
    return;
  }

  const db = getDatabase();
  const tokenHash = hashSessionToken(token);

  await db
    .update(sessions)
    .set({
      revokedAt: new Date(),
    })
    .where(eq(sessions.tokenHash, tokenHash));
}
