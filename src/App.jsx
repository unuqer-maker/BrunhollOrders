import { useEffect, useMemo, useRef, useState } from "react";
import {
  barQueueOrderKey,
  getDefaultBarQueueEntry,
  getItemsForBarQueue,
} from "./barQueue.js";
import {
  DEFAULT_TOP_CATEGORY_KEY,
  getItemZone,
  getTopCategoryByKey,
  MENU_ITEMS,
  TOP_CATEGORIES,
  TABLE_POSITIONS,
  TABLES_LAYOUT,
} from "./menu.js";
import {
  buildDraftLines,
  createEmptyDraftCounts,
  createEmptyDraftExtras,
  createEmptyDraftItemNotes,
  draftTotalItems,
  linesToOrderItems,
  mergeOrderItems,
} from "./orderDraft.js";

const INITIAL_ROOMS = TABLES_LAYOUT.flat().reduce((acc, table) => {
  acc[table] = [];
  return acc;
}, {});

const INITIAL_ORDERS = {};


const MODES = [
  { key: "bar", label: "Bar / Waiters" },
  { key: "kitchen", label: "Kitchen" },
  { key: "reception", label: "Reception" },
];

const pageStyle = {
  minHeight: "100vh",
  background: "#f5f5f5",
  padding: "24px",
  fontFamily: "Arial, sans-serif",
  color: "#000",
};

const cardStyle = {
  background: "white",
  borderRadius: "18px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
};

const backButtonStyle = {
  padding: "10px 16px",
  borderRadius: "10px",
  border: "none",
  cursor: "pointer",
  background: "white",
  color: "#000",
  border: "1px solid #d1d5db",
  fontSize: "16px",
};

const primaryButtonStyle = {
  padding: "16px 24px",
  fontSize: "20px",
  borderRadius: "14px",
  border: "none",
  background: "#dbeafe",
  color: "#000",
  border: "1px solid #93c5fd",
  cursor: "pointer",
  fontWeight: 700,
};

const secondaryButtonStyle = {
  padding: "14px 18px",
  fontSize: "18px",
  borderRadius: "14px",
  border: "none",
  background: "white",
  color: "#000",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
};

function getInitialMode() {
  if (typeof window === "undefined") return "bar";
  const view = new URLSearchParams(window.location.search).get("view");
  return MODES.some((mode) => mode.key === view) ? view : "bar";
}

function formatItemSummary(items) {
  if (!items.length) return "—";
  return items
    .map((item) => {
      const extra = item.extras?.length ? ` +${item.extras.length} extra` : "";
      return `${item.qty}x ${item.name}${extra}`;
    })
    .join(" • ");
}

function formatRoomLabel(input) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().includes("outside") || trimmed.toLowerCase().startsWith("room ")) {
    return trimmed;
  }
  return `Room ${trimmed}`;
}

function formatTicketPlainText(items) {
  return items
    .map((item) => {
      const rows = [`${item.qty}x ${item.name}`];
      (item.extras || []).forEach((extra) => rows.push(`  * ${extra}`));
      if (item.note) rows.push(`  Note: ${item.note}`);
      return rows.join("\n");
    })
    .join("\n\n");
}

function OrderTicketLines({ lines, showItemNotes = true }) {
  if (!lines.length) {
    return <div style={{ color: "#000", fontSize: "15px" }}>Add items from the menu</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px", fontSize: "17px", lineHeight: 1.45, color: "#000" }}>
      {lines.map((line) => (
        <div key={`${line.id}-${line.note}-${line.extras.join(",")}`}>
          <div style={{ fontWeight: 800 }}>
            {line.qty}x {line.name}
          </div>
          {line.extras.map((extra) => (
            <div key={extra} style={{ paddingLeft: "16px", fontWeight: 600 }}>
              * {extra}
            </div>
          ))}
          {showItemNotes && line.note ? (
            <div style={{ paddingLeft: "16px", fontSize: "15px" }}>Note: {line.note}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function getActiveItems(items) {
  return items.filter((item) => item.status !== "PICKED UP");
}

function getKitchenItems(items) {
  return items.filter(
    (item) =>
      item.status !== "PICKED UP" && getItemZone(item.id || item.name) === "kitchen"
  );
}

function shortStatus(status) {
  if (status === "NEW") return "NEW";
  if (status === "IN PREPARATION") return "IN PREP";
  if (status === "READY") return "RDY";
  if (status === "PICKED UP") return "DONE";
  return status;
}

function formatElapsed(createdAt, now) {
  const diffMs = Math.max(0, now - createdAt);
  const mins = Math.floor(diffMs / 60000);
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getNextStatus(status) {
  if (status === "NEW") return "IN PREPARATION";
  if (status === "IN PREPARATION") return "READY";
  if (status === "READY") return "PICKED UP";
  return "NEW";
}

function getOrderStatus(items) {
  if (!items || items.length === 0) return "NEW";
  if (items.every((item) => item.status === "PICKED UP")) return "PICKED UP";
  if (items.some((item) => item.status === "READY")) return "READY";
  if (items.some((item) => item.status === "IN PREPARATION")) return "IN PREPARATION";
  return "NEW";
}


function getStatusColors(status) {
  if (status === "NEW") return { background: "#dbeafe", color: "#000" };
  if (status === "IN PREPARATION" || status === "IN PREP") return { background: "#fde68a", color: "#000" };
  if (status === "READY" || status === "RDY") return { background: "#dcfce7", color: "#000" };
  if (status === "PICKED UP" || status === "DONE") return { background: "#e5e7eb", color: "#000" };
  if (status === "ARCHIVED") return { background: "#f3f4f6", color: "#000" };
  if (status === "EMPTY") return { background: "#f3f4f6", color: "#000" };
  if (status === "ACTIVE") return { background: "#e0f2fe", color: "#000" };
  if (status === "WAITING") return { background: "#ffedd5", color: "#000" };
  if (status === "URGENT") return { background: "#fecaca", color: "#000" };
  return { background: "#d9d9d9", color: "#000" };
}


function ModeSwitcher({ mode, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "5px",
        flexWrap: "wrap",
      }}
    >
      {MODES.map((item) => {
        const active = item.key === mode;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              padding: "3px 8px",
              fontSize: "11px",
              borderRadius: "6px",
              border: active ? "1px solid #93c5fd" : "1px solid #d1d5db",
              background: active ? "#dbeafe" : "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function GlobalBackButton({ disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "3px 8px",
        fontSize: "11px",
        borderRadius: "6px",
        border: disabled ? "1px solid #d1d5db" : "1px solid #fca5a5",
        background: disabled ? "#f3f4f6" : "#fef2f2",
        color: disabled ? "#9ca3af" : "#991b1b",
        cursor: disabled ? "default" : "pointer",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      ← Back
    </button>
  );
}

function TopBar({ mode, onChange, disabled, onBack, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginBottom: "8px",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      <GlobalBackButton disabled={disabled} onClick={onBack} />
      <ModeSwitcher mode={mode} onChange={onChange} />
      {children}
    </div>
  );
}


function StatusBadge({ status }) {
  const colors = getStatusColors(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "7px 11px",
        borderRadius: "999px",
        background: colors.background,
        color: "#000",
        fontSize: "12px",
        fontWeight: 800,
        letterSpacing: "0.3px",
        border: "1px solid #d1d5db",
      }}
    >
      {status}
    </span>
  );
}

function UndoBar({ message, onUndo }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: "18px",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "14px",
        background: "white",
        border: "1px solid #d1d5db",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
        zIndex: 50,
        color: "#000",
        maxWidth: "min(92vw, 520px)",
      }}
    >
      <span style={{ fontWeight: 700 }}>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          ...secondaryButtonStyle,
          padding: "10px 14px",
          fontSize: "16px",
          background: "#dbeafe",
          border: "1px solid #93c5fd",
        }}
      >
        Undo
      </button>
    </div>
  );
}

const STORAGE_KEY = "brunholl_v1";

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== 1) return null;
    return {
      ordersByTable: data.ordersByTable || {},
      roomsByTable: data.roomsByTable || INITIAL_ROOMS,
      barQueueState: data.barQueueState || {},
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function savePersistedState(ordersByTable, roomsByTable, barQueueState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        ordersByTable,
        roomsByTable,
        barQueueState,
      })
    );
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function App() {
  const persisted = useRef(loadPersistedState());

  const [mode, setMode] = useState(getInitialMode);
  const [now, setNow] = useState(Date.now());

  const [selectedTable, setSelectedTable] = useState(null);
  const [tableStage, setTableStage] = useState("overview");
  const [selectedRoom, setSelectedRoom] = useState(null);

  const [draftTopCategory, setDraftTopCategory] = useState(DEFAULT_TOP_CATEGORY_KEY);
  const [draftCounts, setDraftCounts] = useState(() => createEmptyDraftCounts(MENU_ITEMS));
  const [draftExtras, setDraftExtras] = useState(() => createEmptyDraftExtras(MENU_ITEMS));
  const [draftItemNotes, setDraftItemNotes] = useState(() => createEmptyDraftItemNotes(MENU_ITEMS));
  const [draftNoteOpenFor, setDraftNoteOpenFor] = useState(null);
  const [draftNote, setDraftNote] = useState("");

  const [roomsByTable, setRoomsByTable] = useState(persisted.current?.roomsByTable ?? INITIAL_ROOMS);
  const [ordersByTable, setOrdersByTable] = useState(persisted.current?.ordersByTable ?? INITIAL_ORDERS);
  const [receptionTab, setReceptionTab] = useState("active");
  const [barQueueState, setBarQueueState] = useState(persisted.current?.barQueueState ?? {});
  const [undoMessage, setUndoMessage] = useState(null);
  const undoStackRef = useRef([]);

  const recordUndo = (snapshot, message) => {
    undoStackRef.current = [
      { ordersByTable: structuredClone(snapshot), message },
      ...undoStackRef.current,
    ].slice(0, 8);
    setUndoMessage(message);
  };

  const performUndo = () => {
    const entry = undoStackRef.current.shift();
    if (!entry) return;
    setOrdersByTable(entry.ordersByTable);
    setUndoMessage(undoStackRef.current[0]?.message ?? null);
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    savePersistedState(ordersByTable, roomsByTable, barQueueState);
  }, [ordersByTable, roomsByTable, barQueueState]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setSelectedTable(null);
    setTableStage("overview");
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const resetComposeDraft = () => {
    setDraftTopCategory(DEFAULT_TOP_CATEGORY_KEY);
    setDraftCounts(createEmptyDraftCounts(MENU_ITEMS));
    setDraftExtras(createEmptyDraftExtras(MENU_ITEMS));
    setDraftItemNotes(createEmptyDraftItemNotes(MENU_ITEMS));
    setDraftNoteOpenFor(null);
    setDraftNote("");
  };

  const getTableOrders = (table) => ordersByTable[table] || [];

  const getVisibleOrdersForTable = (table) =>
    getTableOrders(table)
      .map((order) => ({
        ...order,
        orderStatus: getOrderStatus(order.items),
      }))
      .filter((order) => order.orderStatus !== "PICKED UP")
      .sort((a, b) => b.createdAt - a.createdAt);

  const allOrders = useMemo(() => {
    const list = [];
    Object.entries(ordersByTable).forEach(([table, orders]) => {
      orders.forEach((order) => {
        list.push({
          ...order,
          table,
          orderStatus: getOrderStatus(order.items),
        });
      });
    });
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [ordersByTable]);

  const barOverviewOrders = useMemo(() => {
    return allOrders
      .map((order) => ({
        ...order,
        queueItems: getItemsForBarQueue(order.items),
      }))
      .filter((order) => order.items.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [allOrders]);

  const getBarQueueEntry = (table, orderId) =>
    barQueueState[barQueueOrderKey(table, orderId)] ?? getDefaultBarQueueEntry();

  const toggleBarItemDone = (table, orderId, itemIndex) => {
    const key = barQueueOrderKey(table, orderId);
    setBarQueueState((prev) => {
      const entry = prev[key] ?? getDefaultBarQueueEntry();
      const indexKey = String(itemIndex);
      return {
        ...prev,
        [key]: {
          ...entry,
          itemsDone: {
            ...entry.itemsDone,
            [indexKey]: !entry.itemsDone[indexKey],
          },
        },
      };
    });
  };

  const toggleBarOrderOk = (table, orderId) => {
    const key = barQueueOrderKey(table, orderId);
    setBarQueueState((prev) => {
      const entry = prev[key] ?? getDefaultBarQueueEntry();
      return {
        ...prev,
        [key]: {
          ...entry,
          orderOk: !entry.orderOk,
        },
      };
    });
  };

  const kitchenOrders = useMemo(() => {
    return allOrders
      .map((order) => {
        const kitchenItems = getKitchenItems(order.items);
        return {
          ...order,
          kitchenItems,
          kitchenStatus: getOrderStatus(kitchenItems),
        };
      })
      .filter((order) => order.kitchenItems.length > 0)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [allOrders]);

  const kitchenStats = useMemo(() => {
    return kitchenOrders.reduce(
      (acc, order) => {
        order.kitchenItems.forEach((item) => {
          if (item.status === "NEW") acc.new += item.qty;
          if (item.status === "IN PREPARATION") acc.prep += item.qty;
          if (item.status === "READY") acc.ready += item.qty;
        });
        return acc;
      },
      { new: 0, prep: 0, ready: 0 }
    );
  }, [kitchenOrders]);

  const kitchenSummary = useMemo(() => {
    const counts = {};
    MENU_ITEMS.filter((item) => item.zone === "kitchen").forEach((item) => {
      counts[item.name] = 0;
    });

    kitchenOrders.forEach((order) => {
      order.kitchenItems.forEach((item) => {
        counts[item.name] = (counts[item.name] || 0) + item.qty;
      });
    });

    return Object.entries(counts)
      .map(([name, qty]) => ({ name, qty }))
      .filter((item) => item.qty > 0)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [kitchenOrders]);

  const receptionOrders = useMemo(() => {
    const cutoff = 24 * 60 * 60 * 1000;
    return allOrders.filter((order) => now - order.createdAt <= cutoff);
  }, [allOrders, now]);

  const selectedOrders = selectedTable ? getVisibleOrdersForTable(selectedTable) : [];

  const getTableTone = (table) => {
    const visibleOrders = getVisibleOrdersForTable(table);

    if (visibleOrders.length === 0) {
      return { label: "EMPTY", background: "#d9d9d9", color: "#000" };
    }

    if (visibleOrders.some((order) => order.orderStatus === "READY")) {
      return { label: "READY", background: "#dcfce7", color: "#000" };
    }

    const oldestAgeMs = Math.max(...visibleOrders.map((order) => now - order.createdAt));
    const oldestMins = Math.floor(oldestAgeMs / 60000);

    if (oldestMins >= 35) return { label: "URGENT", background: "#fecaca", color: "#000" };
    if (oldestMins >= 20) return { label: "WAITING", background: "#ffedd5", color: "#000" };

    return { label: "ACTIVE", background: "#e0f2fe", color: "#000" };
  };

  const openTable = (table) => {
    setSelectedTable(table);
    setTableStage("overview");
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const goBackToTables = () => {
    setSelectedTable(null);
    setTableStage("overview");
    setSelectedRoom(null);
  };

  const startNewOrder = () => {
    setTableStage("choose-customer");
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const startComposeForRoom = (room) => {
    setSelectedRoom(room);
    setTableStage("compose-order");
    resetComposeDraft();
  };

  const addRoom = () => {
    if (!selectedTable) return;

    const value = window.prompt("Enter room number or label");
    if (!value) return;

    const trimmed = value.trim();
    if (!trimmed) return;

    const roomLabel = formatRoomLabel(trimmed);

    setRoomsByTable((prev) => {
      const current = prev[selectedTable] || [];
      if (current.includes(roomLabel)) return prev;
      return {
        ...prev,
        [selectedTable]: [...current, roomLabel],
      };
    });
  };

  const changeQty = (itemId, delta) => {
    setDraftCounts((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) + delta),
    }));
  };

  const toggleDraftExtra = (itemId, extraName) => {
    setDraftExtras((prev) => {
      const current = prev[itemId] || [];
      const next = current.includes(extraName)
        ? current.filter((name) => name !== extraName)
        : [...current, extraName];
      return { ...prev, [itemId]: next };
    });
  };

  const saveOrder = () => {
    if (!selectedTable || !selectedRoom) return;

    const draftLines = buildDraftLines(draftCounts, draftExtras, draftItemNotes, MENU_ITEMS);
    const items = linesToOrderItems(draftLines);

    if (items.length === 0) {
      window.alert("Add at least one item.");
      return;
    }

    const hasBarZoneLines = draftLines.some((line) => getItemZone(line.id) === "bar");
    const orderNote = hasBarZoneLines ? draftNote.trim() : "";

    setOrdersByTable((prev) => {
      recordUndo(prev, `Order saved for ${selectedRoom}`);
      const tableOrders = prev[selectedTable] || [];
      const existing = tableOrders.find(
        (order) => order.room === selectedRoom && getOrderStatus(order.items) !== "PICKED UP"
      );

      if (existing) {
        return {
          ...prev,
          [selectedTable]: tableOrders.map((order) =>
            order.id === existing.id
              ? {
                  ...order,
                  items: mergeOrderItems(order.items, items),
                  note: [order.note, orderNote].filter(Boolean).join(" • ") || order.note,
                }
              : order
          ),
        };
      }

      const newOrder = {
        id: `ord-${Date.now()}`,
        room: selectedRoom,
        createdAt: Date.now(),
        note: orderNote,
        items,
      };

      return {
        ...prev,
        [selectedTable]: [newOrder, ...tableOrders],
      };
    });

    setTableStage("overview");
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const updateOrderItems = (table, orderId, updater, undoLabel) => {
    setOrdersByTable((prev) => {
      if (undoLabel) recordUndo(prev, undoLabel);
      return {
        ...prev,
        [table]: (prev[table] || []).map((order) => {
          if (order.id !== orderId) return order;
          return {
            ...order,
            items: updater(order.items),
          };
        }),
      };
    });
  };

  const cycleLineStatus = (table, orderId, itemName) => {
    updateOrderItems(
      table,
      orderId,
      (items) =>
        items.map((item) => {
          if (item.name !== itemName) return item;
          return { ...item, status: getNextStatus(item.status) };
        }),
      "Status updated"
    );
  };

  const setOrderItemsStatus = (table, orderId, status, zoneFilter) => {
    updateOrderItems(
      table,
      orderId,
      (items) =>
        items.map((item) => {
          if (zoneFilter && getItemZone(item.name) !== zoneFilter) return item;
          return { ...item, status };
        }),
      `Marked ${shortStatus(status)}`
    );
  };

  const markAllReady = (table, orderId) => {
    setOrderItemsStatus(table, orderId, "READY");
  };

  const markAllPickedUp = (table, orderId) => {
    setOrderItemsStatus(table, orderId, "PICKED UP");
  };

  
if (mode === "bar" && !selectedTable) {
    return (
      <div
        style={{
          ...pageStyle,
          height: "100vh",
          overflow: "hidden",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          padding: "10px 14px",
        }}
      >
        <TopBar mode={mode} onChange={switchMode} disabled />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(420px, 1.08fr) minmax(340px, 0.92fr)",
            gap: "18px",
            alignItems: "start",
            flex: 1,
            minHeight: 0,
          }}
        >
          <section style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div className="table-floor-plan">
              {TABLE_POSITIONS.map(({ id, row, col }) => {
                const tone = getTableTone(id);
                const ordersCount = getVisibleOrdersForTable(id).length;
                return (
                  <button
                    key={id}
                    onClick={() => openTable(id)}
                    className="table-card"
                    style={{
                      gridRow: row,
                      gridColumn: col,
                    }}
                  >
                    <span className="table-number">{id}</span>
                    <span
                      className="table-tone"
                      style={{
                        background: tone.background,
                      }}
                    >
                      <span>{tone.label}</span>
                      <span>{ordersCount}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="bar-quick-overview-panel">
            <div
              style={{
                ...cardStyle,
                padding: "14px",
                marginBottom: "12px",
                border: "1px solid #d1d5db",
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#000" }}>Quick overview</div>
              <div style={{ color: "#000", marginTop: "4px", fontSize: "13px" }}>
                Tap items to mark done • OK when finished
              </div>
            </div>

            <div className="bar-quick-overview-list">
              {barOverviewOrders.length === 0 ? (
                <div style={{ ...cardStyle, padding: "18px", color: "#000", border: "1px solid #d1d5db" }}>
                  No orders yet
                </div>
              ) : (
                barOverviewOrders.map((order) => {
                  const queueEntry = getBarQueueEntry(order.table, order.id);
                  const orderDone = queueEntry.orderOk;

                  return (
                    <div
                      key={`${order.table}-${order.id}`}
                      style={{
                        ...cardStyle,
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid #d1d5db",
                        padding: "14px",
                        color: "#000",
                        display: "grid",
                        gap: "10px",
                        background: orderDone ? "#e5e7eb" : "white",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "10px",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openTable(order.table)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            color: "#000",
                          }}
                        >
                          <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>
                            Table {order.table}
                          </div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: "#000", marginTop: "2px" }}>
                            {order.room}
                          </div>
                          <div style={{ color: "#000", marginTop: "4px", fontSize: "12px", fontWeight: 400 }}>
                            {formatElapsed(order.createdAt, now)}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleBarOrderOk(order.table, order.id)}
                          style={{
                            padding: "10px 16px",
                            borderRadius: "10px",
                            border: "1px solid #d1d5db",
                            background: orderDone ? "#d1d5db" : "white",
                            color: "#000",
                            cursor: "pointer",
                            fontWeight: 800,
                            fontSize: "15px",
                            flexShrink: 0,
                          }}
                        >
                          OK
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: "6px" }}>
                        {order.queueItems.length === 0 ? (
                          <div style={{ color: "#000", fontSize: "14px" }}>No bar items on this ticket</div>
                        ) : (
                          order.queueItems.map((item) => {
                            const itemDone = Boolean(queueEntry.itemsDone[String(item.sourceIndex)]);

                            return (
                              <button
                                key={`${order.id}-${item.sourceIndex}-${item.name}`}
                                type="button"
                                onClick={() => toggleBarItemDone(order.table, order.id, item.sourceIndex)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  width: "100%",
                                  textAlign: "left",
                                  border: "1px solid #d1d5db",
                                  borderRadius: "10px",
                                  padding: "10px 12px",
                                  background: itemDone ? "#dcfce7" : "white",
                                  color: "#000",
                                  cursor: "pointer",
                                  fontSize: "15px",
                                  fontWeight: 600,
                                  lineHeight: 1.3,
                                }}
                              >
                                <span style={{ fontSize: "18px", width: "22px", flexShrink: 0 }}>
                                  {itemDone ? "✓" : "□"}
                                </span>
                                <span>
                                  {item.qty}x {item.name}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }

if (mode === "bar" && selectedTable && tableStage === "overview") {
    return (
      <div style={{ ...pageStyle, padding: "10px 14px" }}>
        <TopBar mode={mode} onChange={switchMode} onBack={goBackToTables}>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: "999px",
              background: "#dbeafe",
              color: "#000",
              fontSize: "11px",
              fontWeight: 800,
              border: "1px solid #93c5fd",
              whiteSpace: "nowrap",
            }}
          >
            Table {selectedTable}
          </span>
          <span style={{ color: "#000", fontSize: "12px", fontWeight: 600 }}>
            {selectedOrders.length} open
          </span>
        </TopBar>

        <div style={{ display: "grid", gap: "14px", maxWidth: "900px", flex: 1, overflow: "auto", minHeight: 0 }}>
          {selectedOrders.length === 0 ? (
            <div
              style={{
                ...cardStyle,
                padding: "20px",
                color: "#000",
                border: "1px solid #d1d5db",
              }}
            >
              No active orders
            </div>
          ) : (
            selectedOrders.map((order) => {
              const orderStatus = getOrderStatus(order.items);

              return (
                <div
                  key={order.id}
                  style={{
                    ...cardStyle,
                    padding: "18px",
                    border: "1px solid #d1d5db",
                    borderLeft: `8px solid ${getStatusColors(orderStatus).background}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: "#000" }}>{order.room}</div>
                      <div style={{ color: "#000", marginTop: "4px" }}>
                        Created: {formatElapsed(order.createdAt, now)}
                      </div>
                    </div>

                    <StatusBadge status={orderStatus} />
                  </div>

                  <div style={{ marginTop: "14px" }}>
                    <OrderTicketLines
                      lines={order.items.map((item) => ({
                        id: item.id || item.name,
                        name: item.name,
                        qty: item.qty,
                        extras: item.extras || [],
                        note: item.note || "",
                      }))}
                    />
                  </div>

                  {order.note ? (
                    <div
                      style={{
                        marginTop: "12px",
                        padding: "12px",
                        background: "#fafafa",
                        borderRadius: "12px",
                        color: "#000",
                      }}
                    >
                      Note: {order.note}
                    </div>
                  ) : null}

                  <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => startComposeForRoom(order.room)}
                      style={{
                        ...secondaryButtonStyle,
                        background: "#dbeafe",
                        color: "#000",
                        border: "1px solid #93c5fd",
                      }}
                    >
                      + Add to this room
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <button
            onClick={startNewOrder}
            style={{
              marginTop: "12px",
              padding: "10px 16px",
              fontSize: "14px",
              borderRadius: "8px",
              border: "1px solid #93c5fd",
              background: "#dbeafe",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
              alignSelf: "flex-start",
            }}
          >
            + New Order
          </button>
        </div>
        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }
if (mode === "bar" && selectedTable && tableStage === "choose-customer") {
    const rooms = roomsByTable[selectedTable] || [];

    return (
      <div style={{ ...pageStyle, padding: "10px 14px" }}>
        <TopBar mode={mode} onChange={switchMode} onBack={() => setTableStage("overview")}>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: "999px",
              background: "#dbeafe",
              color: "#000",
              fontSize: "11px",
              fontWeight: 800,
              border: "1px solid #93c5fd",
              whiteSpace: "nowrap",
            }}
          >
            Table {selectedTable}
          </span>
        </TopBar>

        <div style={{ color: "#000", fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Select customer</div>

        <div style={{ marginTop: "22px", display: "grid", gap: "14px", maxWidth: "520px" }}>
          {rooms.map((room) => (
            <button
              key={room}
              onClick={() => startComposeForRoom(room)}
              style={{
                ...cardStyle,
                border: "none",
                padding: "18px 18px",
                cursor: "pointer",
                fontSize: "20px",
                fontWeight: 800,
                textAlign: "left",
              }}
            >
              {room}
            </button>
          ))}

          <button
            onClick={addRoom}
            style={{
              ...cardStyle,
              border: "1px dashed #999",
              background: "transparent",
              padding: "18px 18px",
              cursor: "pointer",
              fontSize: "18px",
              fontWeight: 800,
              textAlign: "left",
            }}
          >
            + Add Room
          </button>
        </div>
        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }

  if (mode === "bar" && selectedTable && tableStage === "compose-order") {
    const activeTop = getTopCategoryByKey(draftTopCategory);
    const draftLines = buildDraftLines(draftCounts, draftExtras, draftItemNotes, MENU_ITEMS);
    const totalItems = draftTotalItems(draftLines);
    const hasBarZoneLines = draftLines.some((line) => getItemZone(line.id) === "bar");
    const showOrderLevelNote = hasBarZoneLines;

    const navButtonStyle = (active) => ({
      width: "100%",
      textAlign: "left",
      background: active ? "#e8f5e9" : "white",
      color: "#000",
      border: active ? "1px solid #a5d6a7" : "1px solid #d1d5db",
      padding: "8px 12px",
      fontSize: "13px",
      fontWeight: 700,
      borderRadius: "10px",
      cursor: "pointer",
    });

    return (
      <div
        style={{
          ...pageStyle,
          height: "100vh",
          overflow: "hidden",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          padding: "12px 16px",
        }}
      >
        <TopBar mode={mode} onChange={switchMode} onBack={() => setTableStage("choose-customer")}>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: "999px",
              background: "#dbeafe",
              color: "#000",
              fontSize: "11px",
              fontWeight: 800,
              border: "1px solid #93c5fd",
              whiteSpace: "nowrap",
            }}
          >
            Table {selectedTable}
          </span>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: "999px",
              background: "#e8f5e9",
              color: "#000",
              fontSize: "11px",
              fontWeight: 800,
              border: "1px solid #a5d6a7",
              whiteSpace: "nowrap",
            }}
          >
            {selectedRoom}
          </span>
        </TopBar>

        <div className="order-compose-layout">
          <div className="order-compose-menu">
            <nav className="order-compose-nav">
              {TOP_CATEGORIES.map((top) => (
                <button
                  key={top.key}
                  type="button"
                  onClick={() => setDraftTopCategory(top.key)}
                  style={navButtonStyle(draftTopCategory === top.key)}
                >
                  {top.label}
                </button>
              ))}
            </nav>

            <div className="order-compose-items">
              {activeTop.subcategories.map((sub) => (
                <div key={sub.key} className="menu-subcategory-section" style={{ marginBottom: "6px" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 800,
                      letterSpacing: "0.6px",
                      color: "#000",
                      padding: "6px 0 4px",
                      borderBottom: "2px solid #d1d5db",
                      marginBottom: "8px",
                      gridColumn: "1 / -1",
                    }}
                  >
                    === {sub.label.toUpperCase()} ===
                  </div>

                  <div className="menu-items-grid">
                    {sub.items.map((menuItem) => {
                      const qty = draftCounts[menuItem.id] || 0;
                      const hasExtras = menuItem.extras?.length > 0;

                      return (
                        <div
                          key={menuItem.id}
                          className="menu-item-card"
                          style={{
                            ...cardStyle,
                            padding: "8px",
                            border: "1px solid #d1d5db",
                            display: "grid",
                            gap: "6px",
                          }}
                        >
                          <div style={{ fontSize: "13px", fontWeight: 800, color: "#000", lineHeight: 1.15 }}>
                            {menuItem.name}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "5px", justifyContent: "center" }}>
                            <button
                              type="button"
                              onClick={() => changeQty(menuItem.id, -1)}
                              style={{
                                width: "30px",
                                height: "30px",
                                borderRadius: "8px",
                                border: "none",
                                cursor: "pointer",
                                background: "#eaeaea",
                                fontSize: "18px",
                                fontWeight: 800,
                                color: "#000",
                                lineHeight: 1,
                              }}
                            >
                              −
                            </button>
                            <div
                              style={{
                                width: "28px",
                                textAlign: "center",
                                fontSize: "16px",
                                fontWeight: 800,
                                color: "#000",
                              }}
                            >
                              {qty}
                            </div>
                            <button
                              type="button"
                              onClick={() => changeQty(menuItem.id, 1)}
                              style={{
                                width: "30px",
                                height: "30px",
                                borderRadius: "8px",
                                border: "1px solid #93c5fd",
                                cursor: "pointer",
                                background: "#dbeafe",
                                fontSize: "18px",
                                fontWeight: 800,
                                color: "#000",
                                lineHeight: 1,
                              }}
                            >
                              +
                            </button>
                          </div>

                          {hasExtras && qty > 0 ? (
                            <div style={{ display: "grid", gap: "4px" }}>
                              {menuItem.extras.map((extraName) => {
                                const checked = (draftExtras[menuItem.id] || []).includes(extraName);
                                return (
                                  <button
                                    key={extraName}
                                    type="button"
                                    onClick={() => toggleDraftExtra(menuItem.id, extraName)}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      textAlign: "left",
                                      border: "1px solid #d1d5db",
                                      borderRadius: "6px",
                                      padding: "5px 8px",
                                      background: checked ? "#dcfce7" : "white",
                                      color: "#000",
                                      cursor: "pointer",
                                      fontSize: "12px",
                                      fontWeight: 600,
                                    }}
                                  >
                                    <span style={{ fontSize: "13px", width: "18px" }}>{checked ? "☑" : "☐"}</span>
                                    {extraName}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}

                          {menuItem.allowItemNote ? (
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  setDraftNoteOpenFor((current) =>
                                    current === menuItem.id ? null : menuItem.id
                                  )
                                }
                                style={{
                                  padding: "5px 8px",
                                  fontSize: "11px",
                                  borderRadius: "8px",
                                  border: "1px solid #d1d5db",
                                  background: draftItemNotes[menuItem.id] ? "#dcfce7" : "white",
                                  color: "#000",
                                  cursor: "pointer",
                                  fontWeight: 700,
                                }}
                              >
                                Note
                              </button>
                              {draftNoteOpenFor === menuItem.id || draftItemNotes[menuItem.id] ? (
                                <textarea
                                  value={draftItemNotes[menuItem.id] || ""}
                                  onChange={(e) =>
                                    setDraftItemNotes((prev) => ({
                                      ...prev,
                                      [menuItem.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="No sauce, gluten free…"
                                  rows={2}
                                  style={{
                                    width: "100%",
                                    marginTop: "4px",
                                    resize: "vertical",
                                    borderRadius: "8px",
                                    border: "1px solid #ddd",
                                    padding: "6px",
                                    fontSize: "11px",
                                    fontFamily: "Arial, sans-serif",
                                    outline: "none",
                                    color: "#000",
                                  }}
                                />
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="order-ticket-panel">
            <div
              style={{
                ...cardStyle,
                padding: "12px",
                border: "1px solid #d1d5db",
                display: "grid",
                gap: "10px",
                fontSize: "13px",
              }}
            >
              <div>
                <div style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.5px", color: "#000" }}>
                  TABLE {selectedTable}
                </div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: "#000", marginTop: "2px" }}>
                  {selectedRoom}
                </div>
              </div>

              <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />

              <div style={{ display: "grid", gap: "6px", fontSize: "13px", lineHeight: 1.4, color: "#000" }}>
                {draftLines.length === 0 ? (
                  <div style={{ color: "#000", fontSize: "12px" }}>Add items from the menu</div>
                ) : (
                  draftLines.map((line) => (
                    <div key={`${line.id}-${line.note}-${line.extras.join(",")}`}>
                      <div style={{ fontWeight: 800 }}>
                        {line.qty}x {line.name}
                      </div>
                      {line.extras.map((extra) => (
                        <div key={extra} style={{ paddingLeft: "12px", fontWeight: 600, fontSize: "12px" }}>
                          * {extra}
                        </div>
                      ))}
                      {line.note ? (
                        <div style={{ paddingLeft: "12px", fontSize: "12px" }}>Note: {line.note}</div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>

              {showOrderLevelNote ? (
                <>
                  <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 800, marginBottom: "6px", color: "#000" }}>
                      Notes
                    </div>
                    <textarea
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Order note"
                      rows={2}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        borderRadius: "10px",
                        border: "1px solid #ddd",
                        padding: "8px",
                        fontSize: "13px",
                        fontFamily: "Arial, sans-serif",
                        outline: "none",
                        color: "#000",
                      }}
                    />
                  </div>
                </>
              ) : null}

              <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />

              <div style={{ fontSize: "13px", fontWeight: 800, color: "#000" }}>Total items: {totalItems}</div>

              <button
                type="button"
                onClick={saveOrder}
                style={{
                  padding: "10px 16px",
                  fontSize: "15px",
                  borderRadius: "10px",
                  border: "1px solid #86efac",
                  background: "#dcfce7",
                  color: "#000",
                  cursor: "pointer",
                  fontWeight: 700,
                  width: "100%",
                }}
              >
                Save Order
              </button>
            </div>
          </aside>
        </div>

        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }

  
if (mode === "kitchen") {
    const shortKitchenStatus = (status) => shortStatus(status);

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f5f5f5",
          padding: "10px 14px",
          fontFamily: "Arial, sans-serif",
          color: "#000",
        }}
      >
        <TopBar mode={mode} onChange={switchMode} disabled />

        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "8px",
            justifyContent: "center",
          }}
        >
          {[
            { label: "OPEN", value: kitchenOrders.length, bg: "#f3f4f6" },
            { label: "NEW", value: kitchenStats.new, bg: "#dbeafe" },
            { label: "PREP", value: kitchenStats.prep, bg: "#fde68a" },
            { label: "RDY", value: kitchenStats.ready, bg: "#dcfce7" },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                width: "90px",
                height: "90px",
                borderRadius: "10px",
                boxShadow: "0 1px 6px rgba(0,0,0,0.10)",
                border: "1px solid #d1d5db",
                textAlign: "center",
                background: stat.bg,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "2px",
                flexShrink: 0,
              }}
            >
              <div style={{ color: "#000", fontSize: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                {stat.label}
              </div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#000", lineHeight: 1 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            ...cardStyle,
            padding: "6px 10px",
            marginBottom: "8px",
            border: "1px solid #d1d5db",
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {kitchenSummary.length === 0 ? (
              <div style={{ color: "#000", fontSize: "13px" }}>No active items</div>
            ) : (
              kitchenSummary.map((item) => (
                <div
                  key={item.name}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: "#f3f4f6",
                    border: "1px solid #d1d5db",
                    fontWeight: 700,
                    color: "#000",
                    fontSize: "13px",
                    lineHeight: 1.2,
                  }}
                >
                  {item.name} • {item.qty}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="kitchen-tickets-grid">
          {kitchenOrders.length === 0 ? (
            <div
              className="kitchen-tickets-grid-empty"
              style={{ ...cardStyle, padding: "16px", color: "#000", border: "1px solid #d1d5db" }}
            >
              No active kitchen tickets
            </div>
          ) : (
            kitchenOrders.map((order) => {
              const orderStatus = order.kitchenStatus;

              return (
                <div
                  key={`${order.table}-${order.id}`}
                  className="kitchen-ticket-card"
                  style={{
                    ...cardStyle,
                    padding: "12px",
                    border: "1px solid #d1d5db",
                    borderLeft: `6px solid ${getStatusColors(orderStatus).background}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      alignItems: "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: "#000", lineHeight: 1.2 }}>
                        {order.table} • {order.room}
                      </div>
                      <div style={{ color: "#000", marginTop: "3px", fontSize: "12px" }}>
                        {formatElapsed(order.createdAt, now)}
                      </div>
                    </div>

                    <StatusBadge status={shortKitchenStatus(orderStatus)} />
                  </div>

                  <div style={{ display: "grid", gap: "8px" }}>
                    {order.kitchenItems.map((item, index) => {
                      const itemStatusStyle = getStatusColors(item.status);

                      return (
                        <button
                          key={`${order.id}-${item.name}-${index}`}
                          onClick={() => cycleLineStatus(order.table, order.id, item.name)}
                          style={{
                            border: "1px solid #d1d5db",
                            width: "100%",
                            cursor: "pointer",
                            textAlign: "left",
                            borderRadius: "12px",
                            padding: "10px",
                            background:
                              item.status === "NEW"
                                ? "#f8fbff"
                                : item.status === "IN PREPARATION"
                                  ? "#fff8e6"
                                  : item.status === "READY"
                                    ? "#f0fff0"
                                    : "#f3f4f6",
                            borderLeft: `5px solid ${itemStatusStyle.background}`,
                            color: "#000",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "8px",
                              alignItems: "center",
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: "15px", fontWeight: 800, color: "#000", lineHeight: 1.15 }}>
                                {item.qty}x {item.name}
                              </div>
                              {(item.extras || []).map((extra) => (
                                <div key={extra} style={{ paddingLeft: "12px", fontSize: "13px", fontWeight: 600 }}>
                                  * {extra}
                                </div>
                              ))}
                              {item.note ? (
                                <div style={{ paddingLeft: "12px", fontSize: "13px" }}>Note: {item.note}</div>
                              ) : null}
                            </div>
                            <StatusBadge status={shortKitchenStatus(item.status)} />
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {order.note ? (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        background: "#fafafa",
                        borderRadius: "10px",
                        color: "#000",
                        border: "1px solid #e5e7eb",
                        fontSize: "13px",
                        lineHeight: 1.35,
                      }}
                    >
                      {order.note}
                    </div>
                  ) : null}

                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => setOrderItemsStatus(order.table, order.id, "READY", "kitchen")}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid #86efac",
                        background: "#dcfce7",
                        color: "#000",
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: "13px",
                      }}
                    >
                      Mark all RDY
                    </button>

                    <button
                      onClick={() => setOrderItemsStatus(order.table, order.id, "PICKED UP", "kitchen")}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid #d1d5db",
                        background: "#e5e7eb",
                        color: "#000",
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: "13px",
                      }}
                    >
                      Mark all DONE
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }

if (mode === "reception") {
    const filteredOrders =
      receptionTab === "active"
        ? allOrders.filter((order) => order.orderStatus !== "PICKED UP")
        : receptionOrders;

    return (
      <div style={{ ...pageStyle, padding: "10px 14px" }}>
        <TopBar mode={mode} onChange={switchMode} disabled />

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {[
            { key: "active", label: "ACTIVE" },
            { key: "history", label: "HISTORY 24H" },
          ].map((tab) => {
            const active = tab.key === receptionTab;
            return (
              <button
                key={tab.key}
                onClick={() => setReceptionTab(tab.key)}
                style={{
                  ...secondaryButtonStyle,
                  background: active ? "#dbeafe" : "white",
                  color: "#000",
                  border: active ? "1px solid #93c5fd" : "none",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gap: "16px",
            width: "100%",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          }}
        >
          {filteredOrders.length === 0 ? (
            <div
              style={{
                ...cardStyle,
                gridColumn: "1 / -1",
                padding: "20px",
                color: "#000",
                border: "1px solid #d1d5db",
              }}
            >
              No orders in this view
            </div>
          ) : (
            filteredOrders.map((order) => (
              <div
                key={`${order.table}-${order.id}`}
                style={{
                  ...cardStyle,
                  padding: "16px",
                  border: "1px solid #d1d5db",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: "#000" }}>
                      Table {order.table} • {order.room}
                    </div>
                    <div style={{ color: "#000", marginTop: "4px" }}>
                      Created: {formatElapsed(order.createdAt, now)}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    padding: "14px",
                    background: "#fafafa",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: "16px",
                    lineHeight: 1.6,
                    color: "#000",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {formatTicketPlainText(order.items)}
                </div>

                {order.note ? (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      background: "#fafafa",
                      borderRadius: "12px",
                      color: "#000",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    Note: {order.note}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        <UndoBar message={undoMessage} onUndo={performUndo} />
      </div>
    );
  }

  return null;
}

export default App;
