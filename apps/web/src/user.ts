export type User = {
  id: string;
  coupleSpaceId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarKey: "initials" | "rose" | "sage" | "plum" | null;
  color: string;
  role: "boyfriend" | "girlfriend";
  preferences: { theme: "system" | "light" | "dark"; reducedMotion: boolean };
};

export function userFrom(payload: unknown): User | null {
  const user = payload && typeof payload === "object" && "user" in payload ? payload.user : null;
  if (!user || typeof user !== "object") return null;
  const value = user as Record<string, unknown>;
  const preferences = value.preferences as Record<string, unknown> | null;
  const avatars = [null, "initials", "rose", "sage", "plum"];
  if (typeof value.id !== "string" || typeof value.coupleSpaceId !== "string"
    || typeof value.username !== "string" || typeof value.displayName !== "string"
    || !(value.nickname === null || typeof value.nickname === "string")
    || !avatars.includes(value.avatarKey as string | null) || typeof value.color !== "string"
    || !["boyfriend", "girlfriend"].includes(value.role as string)
    || !preferences || !["system", "light", "dark"].includes(preferences.theme as string)
    || typeof preferences.reducedMotion !== "boolean") return null;
  return user as User;
}
