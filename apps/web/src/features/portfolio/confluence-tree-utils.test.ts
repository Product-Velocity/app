import { describe, expect, it } from "vitest";
import { filterTree, matchSpaces, pathTo, unloaded, type TreeNode } from "./confluence-tree-utils";

type P = { id: string; title: string; kind?: "page" | "folder" };
const n = (id: string, title: string, children: TreeNode<P>["children"] = null, kind: P["kind"] = "page"): TreeNode<P> => ({ page: { id, title, kind }, children, open: false });

describe("space search", () => {
  const spaces = [{ key: "PRD", name: "Product" }, { key: "GTM", name: "Go to market" }, { key: "ENG", name: "Engineering" }, { key: "PM", name: "Product Management" }];
  it("matches the name or the key, every word, any case; the last used space comes first", () => {
    expect(matchSpaces(spaces, "prod").shown.map((s) => s.key)).toEqual(["PRD", "PM"]);
    expect(matchSpaces(spaces, "prod", "PM").shown.map((s) => s.key)).toEqual(["PM", "PRD"]);
    expect(matchSpaces(spaces, "go mark").shown.map((s) => s.key)).toEqual(["GTM"]);
    expect(matchSpaces(spaces, "eng").shown.map((s) => s.key)).toEqual(["ENG"]);
    expect(matchSpaces(spaces, "zzz")).toEqual({ shown: [], more: 0 });
  });
  it("an empty search lists everything up to the limit and says how many more there are", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `K${i}`, name: `Space ${String(i).padStart(2, "0")}` }));
    const r = matchSpaces(many, "", null, 8);
    expect(r.shown).toHaveLength(8);
    expect(r.more).toBe(4);
  });
});

describe("tree search", () => {
  const tree = [n("1", "Product Home", [n("2", "Procedures", [n("3", "Roadmap Definition Procedure")], "folder"), n("4", "R89 Bidder adapter", null, "folder")]), n("5", "Archive")];
  it("keeps a match with the folders above it, shown open, and drops the rest", () => {
    const r = filterTree(tree, "roadmap");
    expect(r).toHaveLength(1);
    expect(r[0]!.page.id).toBe("1");
    expect(r[0]!.open).toBe(true);
    const procedures = (r[0]!.children as TreeNode<P>[])[0]!;
    expect(procedures.page.id).toBe("2");
    expect((procedures.children as TreeNode<P>[]).map((c) => c.page.id)).toEqual(["3"]);
  });
  it("matches a node that is not loaded by its own title, and several words in any order; an empty search changes nothing", () => {
    expect(filterTree(tree, "bidder")[0]!.page.id).toBe("1");
    expect(filterTree(tree, "adapter r89").flatMap((x) => (x.children as TreeNode<P>[]).map((c) => c.page.id))).toEqual(["4"]);
    expect(filterTree(tree, "   ")).toBe(tree);
    expect(filterTree(tree, "nothing like it")).toEqual([]);
  });
});

describe("path to a chosen page", () => {
  const tree = [n("1", "Product Home", [n("2", "Procedures", [n("3", "Roadmap")], "folder")])];
  it("lists the titles from the top, or null when the page is not loaded", () => {
    expect(pathTo(tree, "3")).toEqual(["Product Home", "Procedures", "Roadmap"]);
    expect(pathTo(tree, "1")).toEqual(["Product Home"]);
    expect(pathTo(tree, "99")).toBeNull();
  });
});

describe("what a search still has to load", () => {
  it("lists nodes that were never opened, folders first, then the shallowest, and stops at the limit", () => {
    const tree = [n("1", "Home", [n("2", "A page"), n("3", "A folder", null, "folder")]), n("4", "Top folder", null, "folder"), n("5", "Loaded", [])];
    expect(unloaded(tree, 10)).toEqual([["4"], ["1", "3"], ["1", "2"]]);
    expect(unloaded(tree, 1)).toEqual([["4"]]);
  });
});
