import { describe, expect, it } from "vitest";
import { userFrom } from "../../apps/web/src/user";
import { nhi, phong } from "../fixtures/users.js";

describe("user response contract", () => {
  it.each([phong, nhi])("accepts seeded user $username", (user) => {
    expect(userFrom({ user })).toEqual(user);
  });

  it("rejects malformed or expanded roles", () => {
    expect(userFrom({ user: { ...phong, role: "admin" } })).toBeNull();
    expect(userFrom({ user: { ...phong, preferences: { theme: "neon", reducedMotion: false } } })).toBeNull();
    expect(userFrom(null)).toBeNull();
  });
});
