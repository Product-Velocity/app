import { describe, expect, it } from "vitest";
import { findPerson, nameFromEmail, parsePersonInput, splitFullName } from "./people";

describe("parsePersonInput", () => {
  it("takes a plain name", () => expect(parsePersonInput("  Jane   Doe ")).toEqual({ name: "Jane Doe", firstName: "Jane", lastName: "Doe", email: null }));
  it("takes a name with an address in angle brackets or after a comma", () => {
    expect(parsePersonInput("Ravi Rao <Ravi@Example.test>")).toEqual({ name: "Ravi Rao", firstName: "Ravi", lastName: "Rao", email: "ravi@example.test" });
    expect(parsePersonInput("Ravi Rao, ravi@example.test")).toEqual({ name: "Ravi Rao", firstName: "Ravi", lastName: "Rao", email: "ravi@example.test" });
  });
  it("makes a name from a bare address", () => expect(parsePersonInput("jane.doe+pv@example.test")).toEqual({ name: "Jane Doe", firstName: "Jane", lastName: "Doe", email: "jane.doe+pv@example.test" }));
  it("refuses nothing, and a name that is too long", () => {
    expect(parsePersonInput("   ")).toBeNull();
    expect(parsePersonInput("x".repeat(121))).toBeNull();
  });
  it("reads a comma that is not followed by an address as Last, First", () => expect(parsePersonInput("Doe, Jane")).toEqual({ name: "Jane Doe", firstName: "Jane", lastName: "Doe", email: null }));
  it("keeps a single name as a first name only, and limits each name to 60 characters", () => {
    expect(parsePersonInput("Cher")).toEqual({ name: "Cher", firstName: "Cher", lastName: null, email: null });
    expect(parsePersonInput(`${"x".repeat(61)} Doe`)).toBeNull();
    expect(parsePersonInput(`Jo ${"y".repeat(61)}`)).toBeNull();
  });
});

describe("nameFromEmail / findPerson", () => {
  it("capitalises the words of the local part", () => expect(nameFromEmail("a_b-c@x.test")).toBe("A B C"));
  const people = [{ id: "1", name: "Jane Doe", email: "jane@x.test" }, { id: "2", name: "ana@x.test", email: "ana@x.test" }];
  it("finds a person by name or by address, in any case", () => {
    expect(findPerson(people, { name: "jane doe", firstName: "jane", lastName: "doe", email: null })?.id).toBe("1");
    expect(findPerson(people, { name: "Ana", firstName: "Ana", lastName: null, email: "ana@x.test" })?.id).toBe("2");
    expect(findPerson(people, { name: "New Person", firstName: "New", lastName: "Person", email: null })).toBeNull();
  });
});

describe("splitFullName", () => {
  it("is the first word and the rest, or Last, First with a comma, and never a guess from an address", () => {
    expect(splitFullName("Mary Ann Smith")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(splitFullName("Jan van der Berg")).toEqual({ firstName: "Jan", lastName: "van der Berg" });
    expect(splitFullName("Berg, Jan")).toEqual({ firstName: "Jan", lastName: "Berg" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitFullName("Berg,")).toEqual({ firstName: "Berg", lastName: null });
  });
});

