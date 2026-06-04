import type { TenantMembership } from "./auth.service.ts";

export const tenantPermissions = [
  "inbox.read",
  "inbox.update",
  "products.read",
  "products.create",
  "products.update",
  "orders.read",
  "orders.create",
  "orders.update",
  "contacts.read",
  "contacts.manage",
  "commissions.read",
  "commissions.update",
  "reports.read",
  "settings.whatsapp.manage",
  "settings.tracking.manage",
  "settings.users.manage",
] as const;

export type TenantPermission = (typeof tenantPermissions)[number];
export type TenantRole = TenantMembership["role"];

const ownerPermissions = tenantPermissions;

const managerPermissions = [
  "inbox.read",
  "inbox.update",
  "products.read",
  "products.create",
  "products.update",
  "orders.read",
  "orders.create",
  "orders.update",
  "contacts.read",
  "contacts.manage",
  "commissions.read",
  "reports.read",
  "settings.tracking.manage",
] as const satisfies readonly TenantPermission[];

const agentPermissions = [
  "products.read",
  "orders.read",
  "orders.update",
  "contacts.read",
] as const satisfies readonly TenantPermission[];

const viewerPermissions = [
  "inbox.read",
  "products.read",
  "orders.read",
  "contacts.read",
  "commissions.read",
  "reports.read",
] as const satisfies readonly TenantPermission[];

const accountantPermissions = [
  "products.read",
  "orders.read",
  "contacts.read",
  "commissions.read",
  "commissions.update",
  "reports.read",
] as const satisfies readonly TenantPermission[];

const permissionsByRole = {
  owner: new Set<TenantPermission>(ownerPermissions),
  manager: new Set<TenantPermission>(managerPermissions),
  agent: new Set<TenantPermission>(agentPermissions),
  viewer: new Set<TenantPermission>(viewerPermissions),
  accountant: new Set<TenantPermission>(accountantPermissions),
} satisfies Record<TenantRole, ReadonlySet<TenantPermission>>;

export function roleHasPermission(
  role: TenantRole,
  permission: TenantPermission,
): boolean {
  return permissionsByRole[role].has(permission);
}
