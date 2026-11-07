export const ADMIN_ROLES = ["owner", "staff"] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

/** The authenticated admin attached to `res.locals.admin` by the auth middleware. */
export interface AuthAdmin {
  id: string;
  role: AdminRoleName;
}
