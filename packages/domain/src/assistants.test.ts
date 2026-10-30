import { describe, expect, it } from "vitest";
import { ASSISTANT_INFO, detectAssistant, setupGuides } from "./assistants";

describe("detectAssistant", () => {
  it("recognises the clients by the name they register with", () => {
    expect(detectAssistant("Claude")).toBe("claude");
    expect(detectAssistant("Claude Code (product-velocity)")).toBe("claude");
    expect(detectAssistant("ChatGPT")).toBe("chatgpt");
    expect(detectAssistant("OpenAI MCP")).toBe("chatgpt");
    expect(detectAssistant("Gemini CLI MCP Client")).toBe("gemini");
    expect(detectAssistant("Google Gemini")).toBe("gemini");
    expect(detectAssistant("My own script")).toBe("other");
    expect(detectAssistant(null, undefined, "")).toBe("other");
  });
  it("takes the first name that says something, and Claude wins when a name mentions two", () => {
    expect(detectAssistant("Some client", "openai-mcp/1.0.0")).toBe("chatgpt");
    expect(detectAssistant("Claude for Google Docs")).toBe("claude");
  });
});

describe("assistant info and setup guides", () => {
  it("only ChatGPT needs search and fetch, only Gemini needs simple schemas, and ChatGPT cannot start prompts", () => {
    expect(Object.values(ASSISTANT_INFO).filter((a) => a.searchFetch).map((a) => a.id)).toEqual(["chatgpt"]);
    expect(Object.values(ASSISTANT_INFO).filter((a) => a.simpleSchemas).map((a) => a.id)).toEqual(["gemini"]);
    expect(ASSISTANT_INFO.chatgpt.prompts).toBe(false);
  });
  it("has a guide for Claude, ChatGPT and Gemini with the connector address in it", () => {
    const g = setupGuides("https://pv.example/mcp");
    expect(g.map((x) => x.assistant)).toEqual(["claude", "chatgpt", "gemini"]);
    expect(g.find((x) => x.assistant === "claude")!.snippet!.code).toContain("https://pv.example/mcp");
    expect(g.find((x) => x.assistant === "gemini")!.snippet!.code).toContain("\"httpUrl\": \"https://pv.example/mcp\"");
    expect(g.find((x) => x.assistant === "chatgpt")!.steps.join(" ")).toMatch(/Developer mode/);
  });
});
