/**
 * Роли пользователей и маршрутизация на «свой» рабочий экран.
 * Один пользователь может иметь несколько ролей — домашний экран выбирается
 * по приоритету (офисные роли важнее полевых, портал — последним).
 */
export const ROLES = [
  "admin",
  "office",
  "fueler",
  "itr",
  "checker",
  "contractor",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  office: "Офис / бухгалтерия",
  fueler: "Заправщик",
  itr: "Ответственный ИТР",
  checker: "Учётчик на разгрузке",
  contractor: "Подрядчик",
};

/** Домашний экран роли (приоритет сверху вниз при нескольких ролях). */
const HOME_BY_PRIORITY: ReadonlyArray<readonly [Role, string]> = [
  ["admin", "/fleet/dashboard"],
  ["office", "/fleet/dashboard"],
  ["fueler", "/fleet/fuel/issue"],
  ["itr", "/fleet/shifts"],
  ["checker", "/fleet/trips"],
  ["contractor", "/portal"],
];

/** Куда направить пользователя после входа исходя из его ролей. */
export function homePathForRoles(roles: readonly string[]): string {
  for (const [role, path] of HOME_BY_PRIORITY) {
    if (roles.includes(role)) return path;
  }
  return "/no-access";
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
