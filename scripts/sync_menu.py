#!/usr/bin/env python3
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parents[1]
xlsx = root / "src" / "menu.database.xlsx"
legacy = root / "src" / "menu.json"
out = root / "src" / "data" / "menu.json"
source = xlsx if xlsx.exists() else legacy if legacy.exists() else None
if not source:
    sys.exit("No menu database at src/menu.database.xlsx")

ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(source) as z:
    sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
    strings = []
    for si in sst.findall("m:si", ns):
        t = si.find("m:t", ns)
        if t is not None and t.text:
            strings.append(t.text)
        else:
            strings.append("".join((r.find("m:t", ns).text or "") for r in si.findall("m:r", ns)))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.findall("m:sheetData/m:row", ns):
        vals = []
        for c in row.findall("m:c", ns):
            v = c.find("m:v", ns)
            if v is None:
                vals.append("")
            elif c.get("t") == "s":
                vals.append(strings[int(v.text)])
            else:
                vals.append(v.text)
        rows.append(vals)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


items = []
for r in rows[1:]:
    if not r or not r[0]:
        continue
    active = str(r[5]).strip() in ("1", "1.0", "TRUE", "true")
    items.append(
        {
            "name": r[0],
            "id": r[1],
            "zones": r[2],
            "category": r[3],
            "subcategory": r[4],
            "active": active,
            "sort": float(r[6] or 0),
            "applies_to": (r[7] if len(r) > 7 else "").strip(),
        }
    )

burger_extras = [i for i in items if i["applies_to"] == "burger" and i["active"]]
burger_extra_names = [i["name"] for i in burger_extras]
orderable = [i for i in items if i["active"] and not i["applies_to"]]

tree = defaultdict(lambda: defaultdict(list))
for item in orderable:
    tree[item["category"]][item["subcategory"]].append(item)

for cat in tree:
    for sub in tree[cat]:
        tree[cat][sub].sort(key=lambda x: x["sort"])


def primary_zone(zones):
    parts = [p.strip() for p in zones.split(",") if p.strip()]
    return parts[0] if parts else "kitchen"


def cat_min_sort(sub_dict):
    """Return the minimum item.sort in a subcategory dict, or 0 if empty."""
    return min((i["sort"] for i in sub_dict), default=0)

# Hardcoded category ordering — all unknown categories append after these
CATEGORY_ORDER = ["Food", "Sides", "Drink Menu", "Dessert", "Cold and Hot"]
DRINK_MENU_SUBCATEGORY_ORDER = ["Beer", "White Wine", "Red Wine", "Soda", "Water", "Spirit"]

def category_sort_key(cat_label):
    """Sort key for top-level categories. Known categories get their index, unknown go last."""
    if cat_label in CATEGORY_ORDER:
        return CATEGORY_ORDER.index(cat_label)
    return 999

def subcategory_sort_key(sub_label, parent_label=None):
    """Sort key for subcategories. Drink Menu uses predefined order."""
    if parent_label == "Drink Menu" and sub_label in DRINK_MENU_SUBCATEGORY_ORDER:
        return DRINK_MENU_SUBCATEGORY_ORDER.index(sub_label)
    return 999

top_categories = []
for cat_label, cat_data in sorted(tree.items(), key=lambda kv: category_sort_key(kv[0])):
    subs = []
    the_sort_key = cat_min_sort if cat_label != "Drink Menu" else lambda sd: subcategory_sort_key(list(sd.keys())[0], cat_label)
    for sub_label, sub_items in sorted(cat_data.items(), key=lambda kv: subcategory_sort_key(kv[0], cat_label)):
        zone = primary_zone(sub_items[0]["zones"])
        is_food = cat_label == "Food"
        menu_items = []
        for row in sorted(sub_items, key=lambda x: x["sort"]):
            entry = {
                "id": row["id"],
                "name": row["name"],
                "sort": row["sort"],
                "zones": row["zones"],
                "allowItemNote": is_food,
            }
            if row["id"] in ("regular_burger", "veggie_burger"):
                entry["extras"] = burger_extra_names
            menu_items.append(entry)
        subs.append({"key": slug(sub_label), "label": sub_label, "zone": zone, "items": menu_items})
    top_categories.append({"key": slug(cat_label), "label": cat_label, "subcategories": subs})

payload = {
    "version": 1,
    "source": source.name,
    "topCategories": top_categories,
    "burgerExtras": [{"id": i["id"], "name": i["name"]} for i in burger_extras],
}

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
count = sum(len(s["items"]) for c in top_categories for s in c["subcategories"])
print(f"Wrote {out} ({count} items from {source.name})")
