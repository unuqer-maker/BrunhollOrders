import { getMenuItem } from "./menu.js";

export function createEmptyDraftCounts(menuItems) {
  return menuItems.reduce((acc, item) => {
    acc[item.id] = 0;
    return acc;
  }, {});
}

export function createEmptyDraftExtras(menuItems) {
  return menuItems.reduce((acc, item) => {
    if (item.extras?.length) acc[item.id] = [];
    return acc;
  }, {});
}

export function createEmptyDraftItemNotes(menuItems) {
  return menuItems.reduce((acc, item) => {
    if (item.allowItemNote) acc[item.id] = "";
    return acc;
  }, {});
}

export function buildDraftLines(draftCounts, draftExtras, draftItemNotes, menuItems) {
  const lines = [];
  menuItems.forEach((menuItem) => {
    const qty = draftCounts[menuItem.id] || 0;
    if (qty <= 0) return;
    lines.push({
      id: menuItem.id,
      name: menuItem.name,
      qty,
      extras: [...(draftExtras[menuItem.id] || [])],
      note: (draftItemNotes[menuItem.id] || "").trim(),
    });
  });
  return lines;
}

export function draftTotalItems(lines) {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

let _lineCounter = 0;

export function linesToOrderItems(lines) {
  return lines.map((line) => ({
    id: line.id,
    name: line.name,
    qty: line.qty,
    status: "NEW",
    extras: line.extras?.length ? [...line.extras] : null,
    note: line.note || null,
    lineId: `line-${Date.now()}-${++_lineCounter}`,
  }));
}

export function mergeOrderItems(existingItems, addedItems) {
  const merged = existingItems.map((item) => ({ ...item, extras: item.extras ? [...item.extras] : null }));

  addedItems.forEach((added) => {
    const key = lineKey(added);
    // Only merge into existing items that are still in status "NEW"
    // Items that are IN PREP, RDY, or PICKED must keep their qty separate
    const match = merged.find((item) => lineKey(item) === key && item.status === "NEW");
    if (match) {
      match.qty += added.qty;
    } else {
      merged.push({
        ...added,
        extras: added.extras ? [...added.extras] : null,
      });
    }
  });
  return merged;
}

function lineKey(item) {
  const extras = (item.extras || []).slice().sort().join("|");
  return `${item.id || item.name}|${extras}|${item.note || ""}`;
}

export function formatLineForDisplay(item) {
  const menu = getMenuItem(item.id || item.name);
  const name = item.name || menu?.name || item.id;
  return { name, qty: item.qty, extras: item.extras || [], note: item.note || "" };
}
