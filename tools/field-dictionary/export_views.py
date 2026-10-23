"""Generates packages/domain/src/default-views.json from docs/reference/default-views.csv.

Run from the repo root: python3 tools/field-dictionary/export_views.py
The CSV (the workbook sheet "Default views (ordered)") is the source; the JSON is what the code reads.
`registry.test.ts` compares the two, so a CSV change that is not regenerated fails the build.
"""
import csv, json

SRC = "docs/reference/default-views.csv"
OUT = "packages/domain/src/default-views.json"

views: dict[str, dict] = {}
with open(SRC, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        v = views.setdefault(r["view"], {"columns": [], "pinned": []})
        assert int(r["position"]) == len(v["columns"]) + 1, f'{r["view"]}: position {r["position"]} out of order'
        v["columns"].append(r["key"])
        if r["pinned"] == "pinned":
            v["pinned"].append(r["key"])

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(views, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(f"wrote {len(views)} views to {OUT}")
