import { describe, expect, it, vi } from "vitest";
import { preferPlatformCreation, preferPlatformRequest } from "./passkey";

describe("passkey options", () => {
  it("drops the cross-platform restriction, asks for a discoverable credential and prefers this device", () => {
    const out = preferPlatformCreation({ challenge: "c", hints: ["security-key"], attestation: "direct", authenticatorSelection: { authenticatorAttachment: "cross-platform", userVerification: "required", residentKey: "discouraged" } }) as Record<string, unknown>;
    expect(out.hints).toEqual(["client-device", "hybrid"]);
    expect(out.attestation).toBe("direct");
    expect(out.authenticatorSelection).toEqual({ userVerification: "required", residentKey: "required", requireResidentKey: true });
    expect(out.challenge).toBe("c");
  });
  it("keeps a platform attachment the server asked for, and works without any selection", () => {
    expect((preferPlatformCreation({ authenticatorSelection: { authenticatorAttachment: "platform" } }).authenticatorSelection as Record<string, unknown>).authenticatorAttachment).toBe("platform");
    expect((preferPlatformCreation({}).authenticatorSelection as Record<string, unknown>).residentKey).toBe("required");
  });
  it("replaces a security-key hint on sign-in and leaves other hints alone", () => {
    expect(preferPlatformRequest({ hints: ["security-key"] }).hints).toEqual(["client-device", "hybrid"]);
    expect(preferPlatformRequest({}).hints).toEqual(["client-device", "hybrid"]);
    expect(preferPlatformRequest({ hints: ["hybrid"] }).hints).toEqual(["hybrid"]);
  });
});

describe("passkey diagnostics", () => {
  it("is empty before any attempt and never holds user details", async () => {
    const { passkeyDiagnostics, recordPasskeyError } = await import("./passkey");
    expect(passkeyDiagnostics()).toBe("");
    recordPasskeyError({ code: "x", name: "NotAllowedError", message: "secret@example.com" });
    const text = passkeyDiagnostics();
    expect(text).toContain("NotAllowedError");
    expect(text).not.toContain("secret@example.com");
  });
});

describe("passkey remembered on this device", () => {
  it("is off until one is added, then on, and off again when forgotten", async () => {
    const { hasPasskeyHere, rememberPasskeyHere, forgetPasskeyHere } = await import("./passkey");
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
    expect(hasPasskeyHere()).toBe(false);
    rememberPasskeyHere();
    expect(hasPasskeyHere()).toBe(true);
    forgetPasskeyHere();
    expect(hasPasskeyHere()).toBe(false);
    vi.unstubAllGlobals();
  });
  it("is off when storage is blocked", async () => {
    const { hasPasskeyHere, rememberPasskeyHere } = await import("./passkey");
    vi.stubGlobal("window", { get localStorage(): never { throw new Error("blocked"); } });
    expect(hasPasskeyHere()).toBe(false);
    expect(() => rememberPasskeyHere()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
