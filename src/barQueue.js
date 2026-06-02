import { getItemZone } from "./menu.js";

/**
 * When true, Quick Overview hides kitchen-zone items (Main, Pinsa, etc.).
 * Set to true when bar queue should only show Drinks, Hot Drinks, Desserts.
 */
export const BAR_QUEUE_HIDE_KITCHEN = false;

export function barQueueOrderKey(table, orderId) {
  return `${table}::${orderId}`;
}

/** Items shown in bar Quick Overview, with stable sourceIndex for toggles. */
export function getItemsForBarQueue(items) {
  return items
    .map((item, sourceIndex) => ({ ...item, sourceIndex }))
    .filter((item) => !BAR_QUEUE_HIDE_KITCHEN || getItemZone(item.id || item.name) === "bar");
}

export function getDefaultBarQueueEntry() {
  return { orderOk: false, itemsDone: {} };
}
