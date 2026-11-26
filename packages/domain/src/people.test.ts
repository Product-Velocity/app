import { describe, expect, it } from "vitest";
import { findPerson, nameFromEmail, parsePersonInput } from "./people";

describe("parsePersonInput", () => {
  it("takes a plain name", () => expect(parsePersonInput("  Jane   Doe ")).toEqual({ name: "Jane Doe", email: null }));
  it("takes a name with an address in angle brackets or after a comma", () => {
    expect(parsePersonInput("Ravi Rao <Ravi@Example.test>")).toEqual({ name: "Ravi Rao", email: "ravi@example.test" });
    expect(parsePersonInput("Ravi Rao, ravi@example.test")).toEqual({ name: "Ravi Rao", email: "ravi@example.test" });
  });
  it("makes a name from a bare address", () => expect(parsePersonInput("jane.doe+pv@example.test")).toEqual({ name: "Jane Doe", email: "jane.doe+pv@example.test" }));
  it("refuses nothing, and a name that is too long", () => {
    expect(parsePersonInput("   ")).toBeNull();
    expect(parsePersonInput("x".repeat(121))).toBeNull();
  });
  it("keeps a comma that is not followed by an address", () => expect(parsePersonInput("Doe, Jane")).toEqual({ name: "Doe, Jane", email: null }));
});

describe("nameFromEmail / findPerson", () => {
  it("capitalises the words of the local part", () => expect(nameFromEmail("a_b-c@x.test")).toBe("A B C"));
  const people = [{ id: "1", name: "Jane Doe", email: "jane@x.test" }, { id: "2", name: "ana@x.test", email: "ana@x.test" }];
  it("finds a person by name or by address, in any case", () => {
    expect(findPerson(people, { name: "jane doe", email: null })?.id).toBe("1");
    expect(findPerson(people, { name: "Ana", email: "ANA@x.test".toLowerCase() })?.id).toBe("2");
    expect(findPerson(people, { name: "New Person", email: null })).toBeNull();
  });
});
