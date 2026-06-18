import menuDatabase from "./data/menu.json";

// ── Google Sheets metadata ──
const SHEET_ID = "1x266nCC-8_l_BjfHa0zgYfClvGCrzKyT";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

// ── Mutable containers that consumers reference by import ──
export const TABLES_LAYOUT = [
  ["5", "10A", "10B", "13"],
  ["4", "9A", "9B", "12"],
  ["3", "8A", "8B", "11"],
  ["2", "7A", "7B"],
  ["1", "6"],
];

export const TABLE_POSITIONS = [
  { id: "5", row: 1, col: 1 },
  { id: "10A", row: 1, col: 2 },
  { id: "10B", row: 1, col: 3 },
  { id: "13", row: 1, col: 4 },
  { id: "4", row: 2, col: 1 },
  { id: "9A", row: 2, col: 2 },
  { id: "9B", row: 2, col: 3 },
  { id: "12", row: 2, col: 4 },
  { id: "3", row: 3, col: 1 },
  { id: "8A", row: 3, col: 2 },
  { id: "8B", row: 3, col: 3 },
  { id: "11", row: 3, col: 4 },
  { id: "2", row: 4, col: 1 },
  { id: "7A", row: 4, col: 2 },
  { id: "7B", row: 4, col: 3 },
  { id: "1", row: 5, col: 1 },
  { id: "6", row: 5, col: 2 },
];

// Build initial data from local fallback
const ITEM_BY_ID = {};
const ITEM_BY_NAME = {};
const ITEM_ZONE_MAP = {};

// ── Helpers ──

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function primaryZone(zones) {
  return (zones || "kitchen").split(",")[0].trim();
}

// Hardcoded ordering that matches the Python script
const CATEGORY_ORDER = ["Food", "Sides", "Drink Menu", "Dessert", "Cold and Hot"];
const DRINK_MENU_SUBCATEGORY_ORDER = [
  "Beer", "White Wine", "Red Wine", "Soda", "Water", "Spirit",
];

function buildMenuFromItems(rawItems) {
  // rawItems: array of { name, id, zones, category, subcategory, sort, applies_to, ... }
  const burgerExtraNames = rawItems
    .filter((i) => i.applies_to === "burger" && i.active)
    .map((i) => i.name);

  const orderable = rawItems.filter((i) => i.active && !i.applies_to);

  // Build tree
  const tree = {};
  orderable.forEach((item) => {
    if (!tree[item.category]) tree[item.category] = {};
    if (!tree[item.category][item.subcategory]) tree[item.category][item.subcategory] = [];
    tree[item.category][item.subcategory].push(item);
  });

  // Sort within subcategories
  Object.values(tree).forEach((cat) => {
    Object.values(cat).forEach((sub) => sub.sort((a, b) => a.sort - b.sort));
  });

  const topCategories = [];
  const sortedCats = Object.entries(tree).sort(([a], [b]) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  sortedCats.forEach(([catLabel, catData]) => {
    const subs = [];
    const sortedSubs = Object.entries(catData).sort(([a], [b]) => {
      if (catLabel === "Drink Menu") {
        const ia = DRINK_MENU_SUBCATEGORY_ORDER.indexOf(a);
        const ib = DRINK_MENU_SUBCATEGORY_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
      return 0;
    });

    sortedSubs.forEach(([subLabel, subItems]) => {
      const zone = primaryZone(subItems[0].zones);
      const isFood = catLabel === "Food";
      const menuItems = subItems.map((row) => {
        const entry = {
          id: row.id,
          name: row.name,
          sort: row.sort,
          zones: row.zones,
          allowItemNote: isFood,
        };
        if (row.id === "regular_burger" || row.id === "veggie_burger") {
          entry.extras = burgerExtraNames;
        }
        return entry;
      });
      subs.push({
        key: slug(subLabel),
        label: subLabel,
        zone,
        items: menuItems,
      });
    });

    topCategories.push({
      key: slug(catLabel),
      label: catLabel,
      subcategories: subs,
    });
  });

  const burgerExtras = rawItems
    .filter((i) => i.applies_to === "burger" && i.active)
    .map((i) => ({ id: i.id, name: i.name }));

  return { topCategories, burgerExtras };
}

function rebuildIndices() {
  // Clear lookup maps
  Object.keys(ITEM_BY_ID).forEach((k) => delete ITEM_BY_ID[k]);
  Object.keys(ITEM_BY_NAME).forEach((k) => delete ITEM_BY_NAME[k]);
  Object.keys(ITEM_ZONE_MAP).forEach((k) => delete ITEM_ZONE_MAP[k]);
  // Clear MENU_ITEMS
  MENU_ITEMS.splice(0, MENU_ITEMS.length);

  // Rebuild from current TOP_CATEGORIES
  TOP_CATEGORIES.forEach((top) => {
    top.subcategories.forEach((sub) => {
      sub.items.forEach((item) => {
        const zones = item.zones || sub.zone || "kitchen";
        const primary = zones.split(",")[0].trim();
        const record = {
          ...item,
          topCategoryKey: top.key,
          topCategoryLabel: top.label,
          subcategoryKey: sub.key,
          subcategoryLabel: sub.label,
          zone: primary,
          zones,
          allowItemNote: Boolean(item.allowItemNote),
          extras: item.extras || [],
        };
        MENU_ITEMS.push(record);
        ITEM_BY_ID[item.id] = record;
        ITEM_BY_NAME[item.name] = record;
        ITEM_ZONE_MAP[item.id] = primary;
        ITEM_ZONE_MAP[item.name] = primary;
      });
    });
  });
}

// Populate initial state from fallback
export const TOP_CATEGORIES = [...(menuDatabase.topCategories || [])];
export const BURGER_EXTRAS = [...(menuDatabase.burgerExtras || [])];
export const MENU_ITEMS = [];

(() => {
  // Build initial MENU_ITEMS from the fallback data
  rebuildIndices();
})();

/**
 * @deprecated flat list — use MENU_ITEMS
 */
export const ALL_MENU_ITEMS = MENU_ITEMS.map((item) => item.name);

export const MENU = TOP_CATEGORIES;

export const DEFAULT_TOP_CATEGORY_KEY = TOP_CATEGORIES[0]?.key ?? "";

export function getMenuItem(idOrName) {
  return ITEM_BY_ID[idOrName] || ITEM_BY_NAME[idOrName] || null;
}

export function getItemZone(idOrName) {
  return ITEM_ZONE_MAP[idOrName] || "kitchen";
}

export function getTopCategoryByKey(key) {
  return TOP_CATEGORIES.find((c) => c.key === key) ?? TOP_CATEGORIES[0];
}

// ── Google Sheets initialization ──

async function parseSheetCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) throw new Error("Empty CSV");

  const header = parseCSVLine(lines[0]);
  const cols = {};
  header.forEach((h, i) => {
    const clean = h.trim().toLowerCase();
    if (clean === "name") cols.name = i;
    if (clean === "id") cols.id = i;
    if (clean === "zones") cols.zones = i;
    if (clean === "category") cols.category = i;
    if (clean === "subcategory") cols.subcategory = i;
    if (clean === "active") cols.active = i;
    if (clean === "sort") cols.sort = i;
    if (clean === "applies_to") cols.appliesTo = i;
  });

  if (cols.name == null) throw new Error("CSV missing 'name' column");

  const items = [];
  for (let r = 1; r < lines.length; r++) {
    const row = parseCSVLine(lines[r]);
    if (!row[cols.name]) continue;
    const active = String(row[cols.active] || "").trim();
    const isActive = active === "1" || active === "1.0" || active.toUpperCase() === "TRUE";
    items.push({
      name: row[cols.name].trim(),
      id: (row[cols.id] || "").trim(),
      zones: (row[cols.zones] || "kitchen").trim(),
      category: (row[cols.category] || "").trim(),
      subcategory: (row[cols.subcategory] || "").trim(),
      active: isActive,
      sort: parseFloat(row[cols.sort]) || 0,
      applies_to: (row[cols.appliesTo] || "").trim(),
    });
  }

  return items;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

let _initialized = false;

/**
 * Fetch menu from Google Sheets.
 * Falls back to menu.json if Sheets is unreachable.
 * Safe to call multiple times — only fetches once.
 */
export async function initMenuFromGoogleSheets() {
  if (_initialized) return;
  _initialized = true;

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    const rawItems = await parseSheetCSV(csvText);
    const { topCategories, burgerExtras } = buildMenuFromItems(rawItems);

    // Mutate the exported arrays so all consumers see the new data
    TOP_CATEGORIES.length = 0;
    TOP_CATEGORIES.push(...topCategories);

    BURGER_EXTRAS.length = 0;
    BURGER_EXTRAS.push(...burgerExtras);

    // Rebuild MENU_ITEMS and lookup maps
    rebuildIndices();

    // Update derived exports
    ALL_MENU_ITEMS.length = 0;
    ALL_MENU_ITEMS.push(...MENU_ITEMS.map((item) => item.name));

    // Update MENU reference (it points to TOP_CATEGORIES anyway)
    // DEFAULT_TOP_CATEGORY_KEY is a string, update it
    // Can't reassign a const, but we can document it's expected to stay
    // No change needed — consumers use it once at render time
  } catch (err) {
    console.warn("Google Sheets unavailable, using local menu.json —", err.message);
  }
}