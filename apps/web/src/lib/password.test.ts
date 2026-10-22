import { describe, expect, it } from "vitest";
import { checkPassword, MIN_PASSWORD_LENGTH } from "./password";

describe("checkPassword: requirements", () => {
  it("requires at least 10 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(checkPassword("Ab1!xyz").ok).toBe(false);
    expect(checkPassword("Ab1!xyz").requirements.find((r) => r.id === "length")?.met).toBe(false);
    expect(checkPassword("Tr1cky-Pass").ok).toBe(true);
  });

  it("requires at least two kinds of characters", () => {
    expect(checkPassword("qwfpgjluyzkx").requirements.find((r) => r.id === "mix")?.met).toBe(false);
    expect(checkPassword("qwfpgjluyzk1").requirements.find((r) => r.id === "mix")?.met).toBe(true);
    // a space counts as a symbol, so a plain passphrase is fine
    expect(checkPassword("purple tiger cloud").ok).toBe(true);
  });

  it.each(["password", "Password123!", "PASSWORD1234", "p@ssw0rd2024", "qwerty12345", "1234567890", "iloveyou123", "Welcome2024!"])(
    "rejects the common password %s",
    (pw) => {
      const r = checkPassword(pw);
      expect(r.ok).toBe(false);
      expect(r.strength.label).toBe("Too weak");
    },
  );

  it("rejects repeating or sequential patterns", () => {
    for (const pw of ["aaaaaaaaaaaa", "abababababab", "111111aaaaaa", "0000000000A"]) {
      expect(checkPassword(pw).ok, pw).toBe(false);
    }
  });

  it("rejects a password that contains the person's email name", () => {
    expect(checkPassword("ashu-Mathura-9", { email: "ashu.mathura@gmail.com" }).ok).toBe(false);
    expect(checkPassword("Tr1cky-Pass", { email: "ashu.mathura@gmail.com" }).ok).toBe(true);
    // short local parts are ignored, they would match too much
    expect(checkPassword("Tr1cky-Pass", { email: "al@example.com" }).ok).toBe(true);
  });

  it("an empty password meets nothing and is Too weak", () => {
    const r = checkPassword("");
    expect(r.ok).toBe(false);
    expect(r.strength.label).toBe("Too weak");
    expect(r.requirements.every((x) => !x.met)).toBe(true);
  });
});

describe("checkPassword: strength", () => {
  it("grows with length and variety", () => {
    expect(checkPassword("qwfpgjluy1").strength.label).toBe("Fair");
    expect(checkPassword("qwfpgjluyz1k").strength.label).toBe("Good");
    expect(checkPassword("Xk9#mQ2vLp4z").strength.label).toBe("Good");
    expect(checkPassword("Xk9#mQ2vLp4z!Rw8").strength.label).toBe("Strong");
    expect(checkPassword("correct horse battery staple").strength.label).toBe("Strong");
  });

  it("scores 0 to 3 and never says Strong for a password that fails a requirement", () => {
    for (const pw of ["", "a", "password1234", "aaaaaaaaaaaaaaaaaaaaaaaa", "Ab1!"]) {
      const r = checkPassword(pw);
      expect(r.strength.score).toBeGreaterThanOrEqual(0);
      expect(r.strength.score).toBeLessThanOrEqual(3);
      if (!r.ok) expect(r.strength.label).not.toBe("Strong");
    }
  });
});
