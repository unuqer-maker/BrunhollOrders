import menuDatabase from "./data/menu.json";

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

export const TOP_CATEGORIES = menuDatabase.topCategories || [];
export const BURGER_EXTRAS = menuDatabase.burgerExtras || [];

export const MENU_ITEMS = [];
const ITEM_BY_ID = {};
const ITEM_BY_NAME = {};
const ITEM_ZONE_MAP = {};

TOP_CATEGORIES.forEach((top) => {
  top.subcategories.forEach((sub) => {
    sub.items.forEach((item) => {
      const zones = item.zones || sub.zone || "kitchen";
      const primaryZone = zones.split(",")[0].trim();
      const record = {
        ...item,
        topCategoryKey: top.key,
        topCategoryLabel: top.label,
        subcategoryKey: sub.key,
        subcategoryLabel: sub.label,
        zone: primaryZone,
        zones,
        allowItemNote: Boolean(item.allowItemNote),
        extras: item.extras || [],
      };
      MENU_ITEMS.push(record);
      ITEM_BY_ID[item.id] = record;
      ITEM_BY_NAME[item.name] = record;
      ITEM_ZONE_MAP[item.id] = primaryZone;
      ITEM_ZONE_MAP[item.name] = primaryZone;
    });
  });
});

/** @deprecated flat list — use MENU_ITEMS */
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

