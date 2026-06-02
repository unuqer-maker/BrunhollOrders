/**
 * Reads src/menu.database.xlsx (Excel export) and writes src/data/menu.json.
 * Run: npm run sync-menu
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const xlsxPath = path.join(root, "src", "menu.database.xlsx");
const legacyXlsx = path.join(root, "src", "menu.json");
const outPath = path.join(root, "src", "data", "menu.json");

const sourcePath = fs.existsSync(xlsxPath)
  ? xlsxPath
  : fs.existsSync(legacyXlsx)
    ? legacyXlsx
    : null;

if (!sourcePath) {
  console.error("No menu database found. Add src/menu.database.xlsx");
  process.exit(1);
}

const py = `
import zipfile, xml.etree.ElementTree as ET, json, re
from collections import defaultdict

zpath = ${JSON.stringify(sourcePath)}
with zipfile.ZipFile(zpath) as z:
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
    strings = []
    for si in sst.findall('m:si', ns):
        t = si.find('m:t', ns)
        if t is not None and t.text:
            strings.append(t.text)
        else:
            strings.append(''.join((r.find('m:t', ns).text or '') for r in si.findall('m:r', ns)))
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = []
    for row in sheet.findall('m:sheetData/m:row', ns):
        vals = []
        for c in row.findall('m:c', ns):
            v = c.find('m:v', ns)
            if v is None:
                vals.append('')
            elif c.get('t') == 's':
                vals.append(strings[int(v.text)])
            else:
                vals.append(v.text)
        rows.append(vals)

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

items = []
for r in rows[1:]:
    if not r or not r[0]:
        continue
    active = str(r[5]).strip() in ('1', '1.0', 'TRUE', 'true')
    items.append({
        'name': r[0],
        'id': r[1],
        'zones': r[2],
        'category': r[3],
        'subcategory': r[4],
        'active': active,
        'sort': float(r[6] or 0),
        'applies_to': (r[7] if len(r) > 7 else '').strip(),
        'note': (r[8] if len(r) > 8 else '').strip(),
    })

burger_extras = [i for i in items if i['applies_to'] == 'burger' and i['active']]
burger_extra_names = [i['name'] for i in burger_extras]

orderable = [i for i in items if i['active'] and not i['applies_to']]

tree = defaultdict(lambda: defaultdict(list))
for item in orderable:
    tree[item['category']][item['subcategory']].append(item)

for cat in tree:
    for sub in tree[cat]:
        tree[cat][sub].sort(key=lambda x: x['sort'])

def primary_zone(zones):
    parts = [p.strip() for p in zones.split(',') if p.strip()]
    return parts[0] if parts else 'kitchen'

def cat_min_sort(sub):
    """Return the minimum item.sort in a subcategory, or 0 if empty."""
    return min((i['sort'] for i in sub), default=0)

top_categories = []
for cat_label, cat_data in sorted(tree.items(), key=lambda kv: min(cat_min_sort(sub) for sub in kv[1].values())):
    subs = []
    for sub_label, sub_items in sorted(cat_data.items(), key=lambda kv: cat_min_sort(kv[1])):
        zone = primary_zone(sub_items[0]['zones'])
        is_food = cat_label == 'Food'
        menu_items = []
        for row in sorted(sub_items, key=lambda x: x['sort']):
            entry = {
                'id': row['id'],
                'name': row['name'],
                'sort': row['sort'],
                'zones': row['zones'],
                'allowItemNote': is_food,
            }
            if row['id'] in ('regular_burger', 'veggie_burger'):
                entry['extras'] = burger_extra_names
            menu_items.append(entry)
        subs.append({
            'key': slug(sub_label),
            'label': sub_label,
            'zone': zone,
            'items': menu_items,
        })
    top_categories.append({
        'key': slug(cat_label),
        'label': cat_label,
        'subcategories': subs,
    })

out = {
    'version': 1,
    'source': path.basename(zpath),
    'topCategories': top_categories,
    'burgerExtras': [{'id': i['id'], 'name': i['name']} for i in burger_extras],
}

print(json.dumps(out, indent=2, ensure_ascii=False))
`;

const json = execSync(`python3 -c ${JSON.stringify(py)}`, { encoding: "utf8" });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, json);
console.log(`Wrote ${outPath} (${orderableCount(json)} orderable items)`);

function orderableCount(raw) {
  const data = JSON.parse(raw);
  return data.topCategories.reduce(
    (n, c) => n + c.subcategories.reduce((m, s) => m + s.items.length, 0),
    0
  );
}
