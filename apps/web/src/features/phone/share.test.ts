import { describe, expect, it } from "vitest";
import { shareToDraft } from "./share";

describe("shareToDraft", () => {
  it("uses the title as the name and keeps text and link as the line", () => {
    expect(shareToDraft({ title: "Dark mode", text: "Customers ask for it", url: "https://example.com/a" })).toEqual({ name: "Dark mode", line: "Customers ask for it https://example.com/a" });
  });
  it("takes the first line of the text when there is no title, and finds a link inside the text", () => {
    expect(shareToDraft({ text: "Offline mode\nUsers lose work on trains https://example.com/x" })).toEqual({ name: "Offline mode", line: "Users lose work on trains https://example.com/x" });
  });
  it("falls back to the host of a lone link", () => {
    expect(shareToDraft({ url: "https://news.example.org/story/1" })).toEqual({ name: "news.example.org", line: "https://news.example.org/story/1" });
  });
  it("drops links that are not http(s) and control characters, and cuts long text", () => {
    expect(shareToDraft({ title: "x\u0000y", url: "javascript:alert(1)" })).toEqual({ name: "xy", line: "" });
    const long = "a".repeat(500);
    expect(shareToDraft({ title: long }).name.length).toBeLessThanOrEqual(120);
    expect(shareToDraft({ title: "t", text: "b".repeat(3000) }).line.length).toBeLessThanOrEqual(1000);
  });
  it("is empty for an empty share", () => expect(shareToDraft({})).toEqual({ name: "", line: "" }));
});
