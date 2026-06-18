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
import { initMenuFromGoogleSheets } from "./menu.js";
import {
  loadLocalState,
  saveLocalState,
  saveState,
  subscribeState,
} from "./firebase.js";

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

const KITCHEN_EXCLUDED_SUBCATEGORIES = new Set(["Sides", "Specials", "Fries"]);

function isKitchenTracked(name) {
  if (getItemZone(name) !== "kitchen") return false;
  const menuItem = MENU_ITEMS.find((mi) => mi.name === name);
  if (menuItem && KITCHEN_EXCLUDED_SUBCATEGORIES.has(menuItem.subcategoryLabel)) return false;
  return true;
}

function getKitchenItems(items) {
  return items.filter(
    (item) =>
      item.status !== "PICKED UP" && item.status !== "PICKED" && isKitchenTracked(item.id || item.name)
  );
}

function shortStatus(status) {
  if (status === "NEW") return "NEW";
  if (status === "IN PREPARATION") return "IN PREP";
  if (status === "READY") return "RDY";
  if (status === "PICKED") return "PCKD";
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
  if (status === "READY") return "PICKED";
  if (status === "PICKED") return "READY";
  return "NEW";
}

function getOrderStatus(items) {
  if (!items || items.length === 0) return "NEW";
  if (items.every((item) => item.status === "PICKED UP")) return "PICKED UP";
  if (items.some((item) => item.status === "READY")) return "READY";
  if (items.some((item) => item.status === "IN PREPARATION")) return "IN PREPARATION";
  if (items.some((item) => item.status === "PICKED")) return "PICKED";
  return "NEW";
}

function getKitchenOrderStatus(allItems, activeItems) {
  // allItems: all kitchen items including PICKED
  // activeItems: kitchen items excluding PICKED (from getKitchenItems)
  // If every item is PICKED → grey card
  if (allItems.every((item) => item.status === "PICKED")) return "PICKED";
  // Use least completed active item
  if (activeItems.some((item) => item.status === "NEW")) return "NEW";
  if (activeItems.some((item) => item.status === "IN PREPARATION")) return "IN PREPARATION";
  return "READY";
}


function getStatusColors(status) {
  if (status === "NEW") return { background: "#ef4444", color: "#fff" };
  if (status === "IN PREPARATION" || status === "IN PREP") return { background: "#f97316", color: "#fff" };
  if (status === "READY" || status === "RDY") return { background: "#22c55e", color: "#fff" };
  if (status === "PICKED" || status === "PCKD") return { background: "#d1d5db", color: "#6b7280" };
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

function ClearAllButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        fontSize: "11px",
        borderRadius: "6px",
        border: "1px solid #fca5a5",
        background: "#fef2f2",
        color: "#991b1b",
        cursor: "pointer",
        fontWeight: 700,
        whiteSpace: "nowrap",
        marginLeft: "auto",
      }}
    >
      Clear All
    </button>
  );
}

function AddRoomModal({ onClose, onConfirm }) {
  const [typed, setTyped] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (typed.trim()) {
      onConfirm(typed.trim());
      onClose();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.20)",
          padding: "28px 32px",
          maxWidth: "440px",
          width: "90vw",
          display: "grid",
          gap: "16px",
          color: "#000",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>
          Add Room
        </div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>
            Enter room number or label
          </div>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="e.g. 8A, STAFF"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              fontSize: "16px",
              outline: "none",
              fontFamily: "Arial, sans-serif",
              color: "#000",
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              background: "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!typed.trim()}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: typed.trim() ? "1px solid #93c5fd" : "1px solid #d1d5db",
              background: typed.trim() ? "#dbeafe" : "#f3f4f6",
              color: typed.trim() ? "#000" : "#9ca3af",
              cursor: typed.trim() ? "pointer" : "default",
              fontWeight: 800,
            }}
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}

function ResetModal({ onClose, onConfirm }) {
  const [typed, setTyped] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && typed !== "RESET") onClose(); }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.20)",
          padding: "28px 32px",
          maxWidth: "440px",
          width: "90vw",
          display: "grid",
          gap: "16px",
          color: "#000",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#991b1b" }}>
          Clear All Orders
        </div>

        <div style={{ fontSize: "14px", lineHeight: 1.5 }}>
          This will permanently delete:
          <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>all orders</li>
            <li>all room assignments</li>
            <li>all bar queue states</li>
          </ul>
        </div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>
            Type RESET to continue
          </div>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder='Type "RESET"'
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              fontSize: "16px",
              outline: "none",
              fontFamily: "Arial, sans-serif",
              color: "#000",
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              background: "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            disabled={typed !== "RESET"}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: typed === "RESET" ? "1px solid #fca5a5" : "1px solid #d1d5db",
              background: typed === "RESET" ? "#fef2f2" : "#f3f4f6",
              color: typed === "RESET" ? "#991b1b" : "#9ca3af",
              cursor: typed === "RESET" ? "pointer" : "default",
              fontWeight: 800,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}


function EditOrderModal({ currentTable, currentRoom, orderIds, onSave, onClose }) {
  const [table, setTable] = useState(currentTable);
  const [room, setRoom] = useState(currentRoom);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.20)",
          padding: "28px 32px",
          maxWidth: "440px",
          width: "90vw",
          display: "grid",
          gap: "16px",
          color: "#000",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>Edit Order</div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>Table</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {TABLE_POSITIONS.map((pos) => (
              <button
                key={pos.id}
                type="button"
                onClick={() => setTable(pos.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: table === pos.id ? "2px solid #93c5fd" : "1px solid #d1d5db",
                  background: table === pos.id ? "#dbeafe" : "white",
                  color: "#000",
                  cursor: "pointer",
                  fontWeight: table === pos.id ? 800 : 600,
                  fontSize: "14px",
                  minWidth: "36px",
                  textAlign: "center",
                }}
              >
                {pos.id}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>Room</div>
          <input
            type="text"
            inputMode="numeric"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="Room number or label"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              fontSize: "16px",
              outline: "none",
              fontFamily: "Arial, sans-serif",
              color: "#000",
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              background: "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(table, room)}
            disabled={!room.trim()}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: room.trim() ? "1px solid #86efac" : "1px solid #d1d5db",
              background: room.trim() ? "#dcfce7" : "#f3f4f6",
              color: room.trim() ? "#000" : "#9ca3af",
              cursor: room.trim() ? "pointer" : "default",
              fontWeight: 800,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function TableSelectModal({ currentTable, currentRoom, onSave, onClose }) {
  const [selectedTable, setSelectedTable] = useState(currentTable);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.20)",
          padding: "28px 32px",
          maxWidth: "440px",
          width: "90vw",
          display: "grid",
          gap: "16px",
          color: "#000",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>Table</div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>
            Select new table
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {TABLE_POSITIONS.map((pos) => (
              <button
                key={pos.id}
                type="button"
                onClick={() => setSelectedTable(pos.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  border: selectedTable === pos.id ? "2px solid #93c5fd" : "1px solid #d1d5db",
                  background: selectedTable === pos.id ? "#dbeafe" : "white",
                  color: "#000",
                  cursor: "pointer",
                  fontWeight: selectedTable === pos.id ? 800 : 600,
                  fontSize: "14px",
                  minWidth: "36px",
                  textAlign: "center",
                }}
              >
                {pos.id}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              background: "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(selectedTable, currentRoom)}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #86efac",
              background: "#dcfce7",
              color: "#000",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RoomEditModal({ currentRoom, onSave, onClose }) {
  const [typed, setTyped] = useState(currentRoom);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (typed.trim()) {
      onSave(typed.trim());
      onClose();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "white",
          borderRadius: "18px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.20)",
          padding: "28px 32px",
          maxWidth: "440px",
          width: "90vw",
          display: "grid",
          gap: "16px",
          color: "#000",
        }}
      >
        <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>Room</div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "#000" }}>
            Enter room number or label
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="e.g. 8A, Outside Guest"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              fontSize: "16px",
              outline: "none",
              fontFamily: "Arial, sans-serif",
              color: "#000",
            }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              background: "white",
              color: "#000",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!typed.trim()}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              borderRadius: "10px",
              border: typed.trim() ? "1px solid #86efac" : "1px solid #d1d5db",
              background: typed.trim() ? "#dcfce7" : "#f3f4f6",
              color: typed.trim() ? "#000" : "#9ca3af",
              cursor: typed.trim() ? "pointer" : "default",
              fontWeight: 800,
            }}
          >
            Save
          </button>
        </div>
      </form>
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
        color: colors.color,
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

function App() {
  const local = useRef(loadLocalState());

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

  const [roomsByTable, setRoomsByTable] = useState(local.current?.roomsByTable ?? INITIAL_ROOMS);
  const [ordersByTable, setOrdersByTable] = useState(local.current?.ordersByTable ?? INITIAL_ORDERS);
  const [receptionTab, setReceptionTab] = useState("active");
  const [barQueueState, setBarQueueState] = useState(local.current?.barQueueState ?? {});
  const [showResetModal, setShowResetModal] = useState(false);
  const [showAddRoomModal, setShowAddRoomModal] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [barCollapsed, setBarCollapsed] = useState(local.current?.barCollapsed ?? {});
  const [confirmDone, setConfirmDone] = useState({});
  const [receptionChecklist, setReceptionChecklist] = useState(
    local.current?.receptionChecklist ?? {}
  );
  const [showEditOrderModal, setShowEditOrderModal] = useState(false);
  const [editingOrderGroup, setEditingOrderGroup] = useState(null);
  const [editType, setEditType] = useState(null); // "table" or "room"
  const [editValue, setEditValue] = useState("");
  const [showTableEditModal, setShowTableEditModal] = useState(false);
  const [showRoomEditModal, setShowRoomEditModal] = useState(false);
  const [editingOrderInfo, setEditingOrderInfo] = useState(null); // { table, orderId, room }
  const kitchenIdsRef = useRef(new Set());
  const receptionChecklistRef = useRef(receptionChecklist);
  receptionChecklistRef.current = receptionChecklist;
  const remoteReceptionChecklist = useRef(false);

  const toggleReceptionItem = (orderId, itemName) => {
    setReceptionChecklist((prev) => {
      const key = `${orderId}-${itemName}`;
      const next = { ...prev, [key]: !prev[key] };
      return next;
    });
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Track mobile breakpoint for responsive compose-order layout
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load menu from Google Sheets on app start (falls back to local menu.json)
  useEffect(() => { initMenuFromGoogleSheets(); }, []);

  // Refs holding latest state for snapshot comparison (no stale closures)
  const ordersRef = useRef(ordersByTable);
  const roomsRef = useRef(roomsByTable);
  const barQueueRef = useRef(barQueueState);
  ordersRef.current = ordersByTable;
  roomsRef.current = roomsByTable;
  barQueueRef.current = barQueueState;

  // Flags: true when the latest state change was from a remote snapshot (not local).
  // The write effect skips saving to Firestore when this is set — prevents echo writes.
  const remoteOrders = useRef(false);
  const remoteRooms = useRef(false);
  const remoteBarQueue = useRef(false);
  const initialFirestoreSync = useRef({ orders: false, rooms: false, barQueue: false });
  const initialWriteSkipped = useRef({ orders: false, rooms: false, barQueue: false });

  // Sync to localStorage cache whenever state changes
  useEffect(() => {
    saveLocalState(ordersByTable, roomsByTable, barQueueState);
  }, [ordersByTable, roomsByTable, barQueueState]);

  // Push to Firestore whenever state changes — skip remote-originated changes.
  // IMPORTANT: Skip all writes until the first remote snapshot is received.
  // This prevents old localStorage data from overwriting Firestore on startup.
  useEffect(() => {
    if (remoteOrders.current) { remoteOrders.current = false; return; }
    if (!initialFirestoreSync.current.orders) {
      if (!initialWriteSkipped.current.orders) {
        initialWriteSkipped.current.orders = true;
      }
      return;
    }
    saveState("orders", { ordersByTable });
  }, [ordersByTable]);

  useEffect(() => {
    if (remoteRooms.current) { remoteRooms.current = false; return; }
    if (!initialFirestoreSync.current.rooms) {
      if (!initialWriteSkipped.current.rooms) {
        initialWriteSkipped.current.rooms = true;
      }
      return;
    }
    saveState("rooms", { roomsByTable });
  }, [roomsByTable]);

  useEffect(() => {
    if (remoteBarQueue.current) { remoteBarQueue.current = false; return; }
    if (!initialFirestoreSync.current.barQueue) {
      if (!initialWriteSkipped.current.barQueue) {
        initialWriteSkipped.current.barQueue = true;
      }
      return;
    }
    saveState("barQueue", { barQueueState });
  }, [barQueueState]);

  // Subscribe to Firestore realtime updates — set remote flag on incoming changes.
  // On the very first remote snapshot for each collection, mark initial sync as
  // received so the write effects above can proceed.
  useEffect(() => {
    const unsub = subscribeState("orders", (data) => {
      if (!initialFirestoreSync.current.orders) {
        initialFirestoreSync.current.orders = true;
      }
      if (data?.ordersByTable) {
        const current = JSON.stringify(ordersRef.current);
        const incoming = JSON.stringify(data.ordersByTable);
        if (current !== incoming) {
          remoteOrders.current = true;
          setOrdersByTable(data.ordersByTable);
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeState("rooms", (data) => {
      if (!initialFirestoreSync.current.rooms) {
        initialFirestoreSync.current.rooms = true;
      }
      if (data?.roomsByTable) {
        const current = JSON.stringify(roomsRef.current);
        const incoming = JSON.stringify(data.roomsByTable);
        if (current !== incoming) {
          remoteRooms.current = true;
          setRoomsByTable(data.roomsByTable);
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeState("barQueue", (data) => {
      if (!initialFirestoreSync.current.barQueue) {
        initialFirestoreSync.current.barQueue = true;
      }
      if (data?.barQueueState) {
        const current = JSON.stringify(barQueueRef.current);
        const incoming = JSON.stringify(data.barQueueState);
        if (current !== incoming) {
          remoteBarQueue.current = true;
          setBarQueueState(data.barQueueState);
        }
      }
    });
    return unsub;
  }, []);

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
        const allKitchen = order.items.filter(
          (item) => item.status !== "PICKED UP" && getItemZone(item.id || item.name) === "kitchen"
        );
        const visibleItems = getKitchenItems(order.items);
        return {
          ...order,
          allKitchenItems: allKitchen,
          kitchenItems: visibleItems,
          kitchenStatus: getKitchenOrderStatus(allKitchen, visibleItems),
        };
      })
      .filter((order) => order.allKitchenItems.length > 0)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [allOrders]);

  // Kitchen notification sound — play once per genuinely new ticket
  useEffect(() => {
    if (mode !== "kitchen") return;
    const current = new Set(kitchenOrders.map((o) => o.id));
    if (kitchenIdsRef.current.size > 0) {
      for (const id of current) {
        if (!kitchenIdsRef.current.has(id)) {
          try { new Audio("/sounds/new-order.mp3").play(); } catch {}
          break;
        }
      }
    }
    kitchenIdsRef.current = current;
  }, [kitchenOrders, mode]);

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

    const flat = Object.entries(counts)
      .map(([name, qty]) => ({ name, qty }))
      .filter((item) => item.qty > 0)
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

    const catOrder = TOP_CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.label));
    const groups = {};
    flat.forEach((item) => {
      const menuItem = MENU_ITEMS.find((mi) => mi.name === item.name);
      const catLabel = menuItem?.subcategoryLabel || "Other";
      if (!groups[catLabel]) {
        groups[catLabel] = { categoryLabel: catLabel, items: [] };
      }
      groups[catLabel].items.push(item);
    });
    const ordered = catOrder.filter((label) => groups[label]).map((label) => groups[label]);
    const others = Object.keys(groups).filter((label) => !catOrder.includes(label)).map((label) => groups[label]);
    return [...ordered, ...others];
  }, [kitchenOrders]);

  const receptionOrders = useMemo(() => {
    const cutoff = 24 * 60 * 60 * 1000;
    return allOrders.filter((order) => now - order.createdAt <= cutoff);
  }, [allOrders, now]);

  const selectedOrders = selectedTable ? getVisibleOrdersForTable(selectedTable) : [];

  // Rooms that belong to this table, have past orders, but no active orders currently
  const oldRoomsOrders = useMemo(() => {
    if (!selectedTable) return [];
    const tableOrders = ordersByTable[selectedTable] || [];
    const rooms = roomsByTable[selectedTable] || [];
    const activeRoomNames = new Set(selectedOrders.map((o) => o.room));

    // Build a map of room → most recent order timestamp
    const roomLatest = {};
    tableOrders.forEach((order) => {
      if (!roomLatest[order.room] || order.createdAt > roomLatest[order.room]) {
        roomLatest[order.room] = order.createdAt;
      }
    });

    // Rooms that have orders but are NOT in activeRoomNames
    return rooms
      .filter((room) => roomLatest[room] != null && !activeRoomNames.has(room))
      .map((room) => ({
        room,
        lastCreatedAt: roomLatest[room],
      }))
      .sort((a, b) => b.lastCreatedAt - a.lastCreatedAt);
  }, [selectedTable, ordersByTable, roomsByTable, selectedOrders]);

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
    setShowAddRoomModal(true);
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const goBackToTables = () => {
    setSelectedTable(null);
    setTableStage("overview");
    setSelectedRoom(null);
  };

  const startNewOrder = () => {
    setShowAddRoomModal(true);
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const startComposeForRoom = (room) => {
    setSelectedRoom(room);
    setTableStage("compose-order");
    resetComposeDraft();
  };

  const openAddRoomModal = () => {
    setShowAddRoomModal(true);
  };

  const confirmAddRoom = (value) => {
    if (!selectedTable || !value.trim()) return;

    const roomLabel = formatRoomLabel(value.trim());

    setRoomsByTable((prev) => {
      const current = prev[selectedTable] || [];
      if (current.includes(roomLabel)) return prev;
      return {
        ...prev,
        [selectedTable]: [...current, roomLabel],
      };
    });

    // Immediately start composing for the new room
    startComposeForRoom(roomLabel);
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

    setSelectedTable(null);
    setTableStage("overview");
    setSelectedRoom(null);
    resetComposeDraft();
  };

  const updateOrderItems = (table, orderId, updater) => {
    setOrdersByTable((prev) => {
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

  const cycleLineStatus = (table, orderId, lineId) => {
    updateOrderItems(
      table,
      orderId,
      (items) =>
        items.map((item) => {
          if (item.lineId !== lineId) return item;
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

  const moveOrder = (currentTable, orderIds, newTable, newRoom) => {
    setOrdersByTable((prev) => {
      const orders = { ...prev };
      const moving = [];
      orderIds.forEach((id) => {
        const idx = (orders[currentTable] || []).findIndex((o) => o.id === id);
        if (idx !== -1) moving.push(orders[currentTable][idx]);
      });
      if (moving.length === 0) return prev;
      orders[currentTable] = (orders[currentTable] || []).filter((o) => !orderIds.includes(o.id));
      const updated = moving.map((o) => ({ ...o, room: newRoom }));
      orders[newTable] = [...(orders[newTable] || []), ...updated];
      return orders;
    });
  };

  const clearAllState = () => {
    setOrdersByTable({});
    setRoomsByTable(INITIAL_ROOMS);
    setBarQueueState({});
  };

  // ── Table / Room edit handlers for bar overview badge editing ──

  const openTableEditModal = (orderTable, orderId, orderRoom) => {
    setEditingOrderInfo({ table: orderTable, orderId, room: orderRoom });
    setShowTableEditModal(true);
  };

  const openRoomEditModal = (orderTable, orderId, orderRoom) => {
    setEditingOrderInfo({ table: orderTable, orderId, room: orderRoom });
    setShowRoomEditModal(true);
  };

  const handleSaveTable = (newTable) => {
    if (!editingOrderInfo) return;
    const { table: oldTable, orderId, room: currentRoom } = editingOrderInfo;

    setOrdersByTable((prev) => {
      const oldOrders = prev[oldTable] || [];
      const moving = oldOrders.find((o) => o.id === orderId);
      if (!moving) return prev;

      const updated = { ...moving };
      delete updated.table;

      return {
        ...prev,
        [oldTable]: oldOrders.filter((o) => o.id !== orderId),
        [newTable]: [...(prev[newTable] || []), updated],
      };
    });

    // Ensure room exists in the new table's room list
    setRoomsByTable((prev) => {
      const newRooms = prev[newTable] || [];
      if (newRooms.includes(currentRoom)) return prev;
      return {
        ...prev,
        [newTable]: [...newRooms, currentRoom],
      };
    });

    setShowTableEditModal(false);
    setEditingOrderInfo(null);
  };

  const handleSaveRoom = (newRoom) => {
    if (!editingOrderInfo) return;
    const { table: orderTable, orderId } = editingOrderInfo;
    const formattedRoom = formatRoomLabel(newRoom);

    setOrdersByTable((prev) => {
      return {
        ...prev,
        [orderTable]: (prev[orderTable] || []).map((order) => {
          if (order.id !== orderId) return order;
          return { ...order, room: formattedRoom };
        }),
      };
    });

    setShowRoomEditModal(false);
    setEditingOrderInfo(null);
  };

  
if (mode === "bar" && !selectedTable) {
    // ── Mobile: vertical stack (tables first, orders scroll below) ──
    if (isMobile) {
      return (
        <>
        <div
          style={{
            ...pageStyle,
            minHeight: "100vh",
            boxSizing: "border-box",
            padding: "8px 10px 0",
          }}
        >
          <TopBar mode={mode} onChange={switchMode} disabled>
            <ClearAllButton onClick={() => setShowResetModal(true)} />
          </TopBar>
          {showResetModal && <ResetModal onClose={() => setShowResetModal(false)} onConfirm={clearAllState} />}

          <div className="bar-home-layout-mobile">
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
                      position: "relative",
                    }}
                  >
                    <span className="table-number">{id}</span>
                    {ordersCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: "8px",
                          right: "8px",
                          background: tone.background,
                          color: tone.color || "#000",
                          fontWeight: 800,
                          fontSize: "clamp(10px, 1.6vmin, 15px)",
                          minWidth: "clamp(20px, 3.2vmin, 28px)",
                          height: "clamp(20px, 3.2vmin, 28px)",
                          borderRadius: "clamp(4px, 0.8vmin, 8px)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px solid #d1d5db",
                          lineHeight: 1,
                        }}
                      >
                        {ordersCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="bar-quick-overview-panel-mobile">
              <div
                style={{
                  ...cardStyle,
                  padding: "10px",
                  marginBottom: "10px",
                  border: "1px solid #d1d5db",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: "16px", fontWeight: 800, color: "#000" }}>Quick overview</div>
                <div style={{ color: "#000", marginTop: "2px", fontSize: "12px" }}>
                  Tap items to mark done • OK when finished
                </div>
              </div>

              <div className="bar-quick-overview-list" style={{ maxHeight: "none", flex: 1 }}>
                {barOverviewOrders.length === 0 ? (
                  <div style={{ ...cardStyle, padding: "14px", color: "#000", border: "1px solid #d1d5db" }}>
                    No orders yet
                  </div>
                ) : (
                  barOverviewOrders.map((order) => {
                    const queueEntry = getBarQueueEntry(order.table, order.id);
                    const orderDone = queueEntry.orderOk;
                    const orderKey = `${order.table}-${order.id}`;
                    const collapsed = barCollapsed[orderKey];
                    const isFoodOrder = order.queueItems.some((item) => {
                      const mi = MENU_ITEMS.find((m) => m.name === item.name);
                      return mi?.topCategoryLabel === "Food";
                    });
                    const timerFrozen = orderDone && !isFoodOrder;

                    const CATEGORY_COLORS = {
                      "Food": "#dbeafe",
                      "Dessert": "#fed7aa",
                      "Drink Menu": "#e9d5ff",
                      "Cold and Hot": "#fecaca",
                      "Sides": "#fce7f3",
                    };

                    const getCatColor = (catLabel) => CATEGORY_COLORS[catLabel] || "#f3f4f6";

                    const toggleBarCollapse = (key) => {
                      setBarCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
                    };

                    return (
                      <div
                        key={orderKey}
                        style={{
                          ...cardStyle,
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid #d1d5db",
                          padding: "12px",
                          color: "#000",
                          display: "grid",
                          gap: collapsed ? "4px" : "8px",
                          background: orderDone ? "#e5e7eb" : "white",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleBarCollapse(orderKey)}
                      >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTableEditModal(order.table, order.id, order.room);
                            }}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "8px",
                              background: "#dbeafe",
                              color: "#000",
                              fontSize: "14px",
                              fontWeight: 800,
                              border: "1px solid #93c5fd",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              fontFamily: "Arial, sans-serif",
                              lineHeight: 1.2,
                            }}
                          >
                            {order.table}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRoomEditModal(order.table, order.id, order.room);
                            }}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "8px",
                              background: "#e8f5e9",
                              color: "#000",
                              fontSize: "14px",
                              fontWeight: 700,
                              border: "1px solid #a5d6a7",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              fontFamily: "Arial, sans-serif",
                              lineHeight: 1.2,
                            }}
                          >
                            {order.room}
                          </button>
                          <span style={{ color: "#000", fontSize: "11px", fontWeight: 400, whiteSpace: "nowrap" }}>
                            {timerFrozen ? formatElapsed(order.createdAt, order.createdAt) : formatElapsed(order.createdAt, now)}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTable(order.table);
                              startComposeForRoom(order.room);
                            }}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "10px",
                              border: "1px solid #93c5fd",
                              background: "#dbeafe",
                              color: "#000",
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: "13px",
                            }}
                          >
                            + Add
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBarOrderOk(order.table, order.id);
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "10px",
                              border: "1px solid #d1d5db",
                              background: orderDone ? "#d1d5db" : "white",
                              color: "#000",
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: "13px",
                              flexShrink: 0,
                            }}
                          >
                            OK
                          </button>
                          <span
                            style={{
                              fontSize: "14px",
                              lineHeight: 1,
                              color: "#9ca3af",
                              flexShrink: 0,
                              transition: "transform 0.15s ease",
                              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              display: "flex",
                              alignItems: "center",
                              cursor: "pointer",
                            }}
                            onClick={(e) => { e.stopPropagation(); toggleBarCollapse(orderKey); }}
                          >
                            ▼
                          </span>
                        </div>
                      </div>

                        {!collapsed && (
                          <div style={{ display: "grid", gap: "6px" }}>
                            {order.queueItems.length === 0 ? (
                              <div style={{ color: "#000", fontSize: "13px" }}>No bar items on this ticket</div>
                            ) : (
                              order.queueItems.map((item) => {
                                const itemDone = Boolean(queueEntry.itemsDone[String(item.sourceIndex)]);
                                const catLabel = (MENU_ITEMS.find((m) => m.name === item.name) || {}).topCategoryLabel;
                                const catBg = getCatColor(catLabel);

                                return (
                                  <button
                                    key={`${order.id}-${item.sourceIndex}-${item.name}`}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); toggleBarItemDone(order.table, order.id, item.sourceIndex); }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "10px",
                                      width: "100%",
                                      textAlign: "left",
                                      border: "1px solid #d1d5db",
                                      borderRadius: "10px",
                                      padding: "10px 12px",
                                      background: itemDone ? "#166534" : catBg,
                                      color: itemDone ? "#fff" : "#000",
                                      cursor: "pointer",
                                      fontSize: "14px",
                                      fontWeight: 600,
                                      lineHeight: 1.3,
                                      minHeight: "44px",
                                      borderLeft: itemDone ? "4px solid #22c55e" : "1px solid #d1d5db",
                                      opacity: itemDone ? 1 : 0.7,
                                    }}
                                  >
                                    <span style={{ fontSize: "16px", width: "22px", flexShrink: 0, color: itemDone ? "#fff" : "#000" }}>
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
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          
        </div>
        {showTableEditModal && editingOrderInfo && (
          <TableSelectModal
            currentTable={editingOrderInfo.table}
            currentRoom={editingOrderInfo.room}
            onSave={handleSaveTable}
            onClose={() => { setShowTableEditModal(false); setEditingOrderInfo(null); }}
          />
        )}
        {showRoomEditModal && editingOrderInfo && (
          <RoomEditModal
            currentRoom={editingOrderInfo.room}
            onSave={handleSaveRoom}
            onClose={() => { setShowRoomEditModal(false); setEditingOrderInfo(null); }}
          />
        )}
        </>
      );
    }

    // ── Desktop bar home layout (unchanged) ──
    return (
      <>
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
        <TopBar mode={mode} onChange={switchMode} disabled>
          <ClearAllButton onClick={() => setShowResetModal(true)} />
        </TopBar>
        {showResetModal && <ResetModal onClose={() => setShowResetModal(false)} onConfirm={clearAllState} />}

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
                      position: "relative",
                    }}
                  >
                    <span className="table-number">{id}</span>
                    {ordersCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: "8px",
                          right: "8px",
                          background: tone.background,
                          color: tone.color || "#000",
                          fontWeight: 800,
                          fontSize: "clamp(11px, 1.6vmin, 17px)",
                          minWidth: "clamp(22px, 3.2vmin, 34px)",
                          height: "clamp(22px, 3.2vmin, 34px)",
                          borderRadius: "clamp(4px, 0.8vmin, 10px)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px solid #d1d5db",
                          lineHeight: 1,
                        }}
                      >
                        {ordersCount}
                      </span>
                    )}
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
                  const orderKey = `${order.table}-${order.id}`;
                  const collapsed = barCollapsed[orderKey];

                  const CATEGORY_COLORS = {
                    "Food": "#dbeafe",
                    "Dessert": "#fed7aa",
                    "Drink Menu": "#e9d5ff",
                    "Cold and Hot": "#fecaca",
                    "Sides": "#fce7f3",
                  };

                  const getCatColor = (catLabel) => CATEGORY_COLORS[catLabel] || "#f3f4f6";

                  const toggleBarCollapse = (key) => {
                    setBarCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
                  };

                  return (
                    <div
                      key={orderKey}
                      style={{
                        ...cardStyle,
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid #d1d5db",
                        padding: "14px",
                        color: "#000",
                        display: "grid",
                        gap: collapsed ? "4px" : "10px",
                        background: orderDone ? "#e5e7eb" : "white",
                        cursor: "pointer",
                      }}
                      onClick={() => toggleBarCollapse(orderKey)}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "10px",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTableEditModal(order.table, order.id, order.room);
                            }}
                            style={{
                              padding: "5px 12px",
                              borderRadius: "8px",
                              background: "#dbeafe",
                              color: "#000",
                              fontSize: "15px",
                              fontWeight: 800,
                              border: "1px solid #93c5fd",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              fontFamily: "Arial, sans-serif",
                              lineHeight: 1.2,
                            }}
                          >
                            {order.table}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRoomEditModal(order.table, order.id, order.room);
                            }}
                            style={{
                              padding: "5px 12px",
                              borderRadius: "8px",
                              background: "#e8f5e9",
                              color: "#000",
                              fontSize: "15px",
                              fontWeight: 700,
                              border: "1px solid #a5d6a7",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              fontFamily: "Arial, sans-serif",
                              lineHeight: 1.2,
                            }}
                          >
                            {order.room}
                          </button>
                          <span style={{ color: "#000", fontSize: "12px", fontWeight: 400, whiteSpace: "nowrap" }}>
                            {formatElapsed(order.createdAt, now)}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTable(order.table);
                              startComposeForRoom(order.room);
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "10px",
                              border: "1px solid #93c5fd",
                              background: "#dbeafe",
                              color: "#000",
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: "14px",
                            }}
                          >
                            + Add
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBarOrderOk(order.table, order.id);
                            }}
                            style={{
                              padding: "8px 16px",
                              borderRadius: "10px",
                              border: "1px solid #d1d5db",
                              background: orderDone ? "#d1d5db" : "white",
                              color: "#000",
                              cursor: "pointer",
                              fontWeight: 800,
                              fontSize: "14px",
                              flexShrink: 0,
                            }}
                          >
                            OK
                          </button>
                          <span
                            style={{
                              fontSize: "16px",
                              lineHeight: 1,
                              color: "#9ca3af",
                              flexShrink: 0,
                              transition: "transform 0.15s ease",
                              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              display: "flex",
                              alignItems: "center",
                              cursor: "pointer",
                            }}
                            onClick={(e) => { e.stopPropagation(); toggleBarCollapse(orderKey); }}
                          >
                            ▼
                          </span>
                        </div>
                      </div>

                      {!collapsed && (
                        <div style={{ display: "grid", gap: "6px" }}>
                          {order.queueItems.length === 0 ? (
                            <div style={{ color: "#000", fontSize: "14px" }}>No bar items on this ticket</div>
                          ) : (
                            order.queueItems.map((item) => {
                              const itemDone = Boolean(queueEntry.itemsDone[String(item.sourceIndex)]);
                              const catLabel = (MENU_ITEMS.find((m) => m.name === item.name) || {}).topCategoryLabel;
                              const catBg = getCatColor(catLabel);

                              return (
                                <button
                                  key={`${order.id}-${item.sourceIndex}-${item.name}`}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleBarItemDone(order.table, order.id, item.sourceIndex); }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    width: "100%",
                                    textAlign: "left",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "10px",
                                    padding: "10px 12px",
                                    background: itemDone ? "#166534" : catBg,
                                    color: itemDone ? "#fff" : "#000",
                                    cursor: "pointer",
                                    fontSize: "15px",
                                    fontWeight: 600,
                                    lineHeight: 1.3,
                                    borderLeft: itemDone ? "4px solid #22c55e" : "1px solid #d1d5db",
                                    opacity: itemDone ? 1 : 0.7,
                                  }}
                                >
                                  <span style={{ fontSize: "18px", width: "22px", flexShrink: 0, color: itemDone ? "#fff" : "#000" }}>
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
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
        
      </div>
        {showTableEditModal && editingOrderInfo && (
          <TableSelectModal
            currentTable={editingOrderInfo.table}
            currentRoom={editingOrderInfo.room}
            onSave={handleSaveTable}
            onClose={() => { setShowTableEditModal(false); setEditingOrderInfo(null); }}
          />
        )}
        {showRoomEditModal && editingOrderInfo && (
          <RoomEditModal
            currentRoom={editingOrderInfo.room}
            onSave={handleSaveRoom}
            onClose={() => { setShowRoomEditModal(false); setEditingOrderInfo(null); }}
          />
        )}
      </>
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
          {/* ── Active Orders ── */}
          {selectedOrders.length > 0 && (
            <>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#000" }}>
                Active Orders ({selectedOrders.length})
              </div>
              {selectedOrders.map((order) => {
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
              })}
            </>
          )}

          {/* ── Old Orders ── */}
          {oldRoomsOrders.length > 0 && (
            <>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#000" }}>
                Old Orders ({oldRoomsOrders.length})
              </div>
              {oldRoomsOrders.map(({ room, lastCreatedAt }) => (
                <div
                  key={room}
                  style={{
                    ...cardStyle,
                    padding: "14px 18px",
                    border: "1px solid #d1d5db",
                    borderLeft: "8px solid #e5e7eb",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "#000" }}>{room}</div>
                    <div style={{ color: "#555", marginTop: "4px", fontSize: "13px" }}>
                      Last order: {formatElapsed(lastCreatedAt, now)} ago
                    </div>
                  </div>
                  <button
                    onClick={() => startComposeForRoom(room)}
                    style={{
                      ...secondaryButtonStyle,
                      padding: "10px 16px",
                      fontSize: "14px",
                      background: "#dbeafe",
                      color: "#000",
                      border: "1px solid #93c5fd",
                    }}
                  >
                    + Add to this room
                  </button>
                </div>
              ))}
            </>
          )}

          {/* ── No Active Orders ── */}
          {selectedOrders.length === 0 && (
            <div
              style={{
                ...cardStyle,
                padding: "20px",
                color: "#000",
                border: "1px solid #d1d5db",
              }}
            >
              No Active Orders {oldRoomsOrders.length > 0 ? `(${oldRoomsOrders.length} old)` : "(0)"}
            </div>
          )}

          <button
            onClick={startNewOrder}
            style={{
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
        {showAddRoomModal && <AddRoomModal onClose={() => setShowAddRoomModal(false)} onConfirm={confirmAddRoom} />}
        
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

    // ── Mobile compose-order layout ──
    if (isMobile) {
      const mobileNavStyle = (active) => ({
        flexShrink: 0,
        whiteSpace: "nowrap",
        background: active ? "#e8f5e9" : "white",
        color: "#000",
        border: active ? "1px solid #a5d6a7" : "1px solid #d1d5db",
        padding: "10px 16px",
        fontSize: "15px",
        fontWeight: 700,
        borderRadius: "12px",
        cursor: "pointer",
        minHeight: "44px",
      });

      // Build a compact summary string for the bottom bar
      const summaryItems = draftLines.slice(0, 2).map((l) => `${l.name} x${l.qty}`);
      const remaining = draftLines.length > 2 ? ` +${draftLines.length - 2} more` : "";
      const bottomBarText =
        draftLines.length === 0
          ? "No items selected"
          : `${totalItems} item${totalItems !== 1 ? "s" : ""} selected`;
      const bottomBarDetail = draftLines.length > 0 ? summaryItems.join(" • ") + remaining : "";

      const handleMobileSave = () => {
        setShowMobileDrawer(false);
        saveOrder();
      };

      return (
        <>
          <div
            style={{
              ...pageStyle,
              height: "100vh",
              overflow: "hidden",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              padding: "8px 10px 0",
            }}
          >
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

          {/* Horizontal scrollable category nav */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              overflowX: "auto",
              paddingBottom: "6px",
              flexShrink: 0,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {TOP_CATEGORIES.map((top) => (
              <button
                key={top.key}
                type="button"
                onClick={() => setDraftTopCategory(top.key)}
                style={mobileNavStyle(draftTopCategory === top.key)}
              >
                {top.label}
              </button>
            ))}
          </div>

          {/* Menu items — single column, scrollable */}
          <div className="mobile-order-menu-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {activeTop.subcategories.map((sub) => (
              <div key={sub.key} style={{ marginBottom: "8px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 800,
                    letterSpacing: "0.6px",
                    color: "#000",
                    padding: "8px 0 4px",
                    borderBottom: "2px solid #d1d5db",
                    marginBottom: "8px",
                  }}
                >
                  === {sub.label.toUpperCase()} ===
                </div>

                {sub.items.map((menuItem) => {
                  const qty = draftCounts[menuItem.id] || 0;
                  const hasExtras = menuItem.extras?.length > 0;

                  return (
                    <div
                      key={menuItem.id}
                      style={{
                        ...cardStyle,
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        marginBottom: "6px",
                        display: "grid",
                        gap: "8px",
                      }}
                    >
                      <div style={{ fontSize: "16px", fontWeight: 800, color: "#000", lineHeight: 1.2 }}>
                        {menuItem.name}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <button
                          type="button"
                          onClick={() => changeQty(menuItem.id, -1)}
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "10px",
                            border: "none",
                            cursor: "pointer",
                            background: "#eaeaea",
                            fontSize: "22px",
                            fontWeight: 800,
                            color: "#000",
                            lineHeight: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          −
                        </button>
                        <div
                          style={{
                            minWidth: "32px",
                            textAlign: "center",
                            fontSize: "20px",
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
                            width: "40px",
                            height: "40px",
                            borderRadius: "10px",
                            border: "1px solid #93c5fd",
                            cursor: "pointer",
                            background: "#dbeafe",
                            fontSize: "22px",
                            fontWeight: 800,
                            color: "#000",
                            lineHeight: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
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
                                  gap: "8px",
                                  textAlign: "left",
                                  border: "1px solid #d1d5db",
                                  borderRadius: "8px",
                                  padding: "8px 12px",
                                  background: checked ? "#dcfce7" : "white",
                                  color: "#000",
                                  cursor: "pointer",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  minHeight: "44px",
                                }}
                              >
                                <span style={{ fontSize: "16px", width: "22px" }}>{checked ? "☑" : "☐"}</span>
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
                              padding: "10px 14px",
                              fontSize: "14px",
                              borderRadius: "10px",
                              border: "1px solid #d1d5db",
                              background: draftItemNotes[menuItem.id] ? "#dcfce7" : "white",
                              color: "#000",
                              cursor: "pointer",
                              fontWeight: 700,
                              minHeight: "44px",
                              width: "100%",
                              textAlign: "left",
                            }}
                          >
                            ✎ Note
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
                              rows={3}
                              style={{
                                width: "100%",
                                marginTop: "6px",
                                resize: "vertical",
                                borderRadius: "10px",
                                border: "1px solid #ddd",
                                padding: "10px",
                                fontSize: "15px",
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
            ))}
          </div>

            
          </div>

          {/* Fixed bottom bar — outside overflow:hidden container so position:fixed works reliably on all browsers */}
          <div className="mobile-order-bottom-bar">
            <button
              type="button"
              onClick={() => setShowMobileDrawer(true)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid #d1d5db",
                background: "#fafafa",
                cursor: "pointer",
                color: "#000",
                textAlign: "left",
                minHeight: "44px",
                minWidth: 0,
              }}
            >
              {totalItems > 0 && <span className="mobile-order-bottom-bar-dot" />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "14px", fontWeight: 800, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {bottomBarText}
                </div>
                {bottomBarDetail ? (
                  <div style={{ fontSize: "11px", color: "#666", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {bottomBarDetail}
                  </div>
                ) : null}
              </div>
            </button>

            <button
              type="button"
              onClick={saveOrder}
              disabled={draftLines.length === 0}
              style={{
                padding: "10px 20px",
                fontSize: "15px",
                fontWeight: 800,
                borderRadius: "10px",
                border: "1px solid #86efac",
                background: draftLines.length > 0 ? "#dcfce7" : "#f3f4f6",
                color: draftLines.length > 0 ? "#000" : "#9ca3af",
                cursor: draftLines.length > 0 ? "pointer" : "default",
                whiteSpace: "nowrap",
                minHeight: "44px",
                flexShrink: 0,
              }}
            >
              Save Order
            </button>
          </div>

          {/* Bottom sheet order drawer — also outside overflow container */}
          {showMobileDrawer ? (
            <div
              className="mobile-order-drawer-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowMobileDrawer(false);
              }}
            >
              <div className="mobile-order-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="mobile-order-drawer-handle" />

                <div className="mobile-order-drawer-body">
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "#000" }}>
                    {selectedRoom} — Table {selectedTable}
                  </div>

                  <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />

                  <div style={{ display: "grid", gap: "8px", fontSize: "16px", lineHeight: 1.4, color: "#000" }}>
                    {draftLines.length === 0 ? (
                      <div style={{ color: "#000", fontSize: "14px" }}>Add items from the menu</div>
                    ) : (
                      draftLines.map((line) => (
                        <div key={`mobile-${line.id}-${line.note}-${line.extras.join(",")}`}>
                          <div style={{ fontWeight: 800 }}>
                            {line.qty}x {line.name}
                          </div>
                          {line.extras.map((extra) => (
                            <div key={extra} style={{ paddingLeft: "14px", fontWeight: 600, fontSize: "14px" }}>
                              * {extra}
                            </div>
                          ))}
                          {line.note ? (
                            <div style={{ paddingLeft: "14px", fontSize: "14px" }}>Note: {line.note}</div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>

                  {showOrderLevelNote ? (
                    <>
                      <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 800, marginBottom: "8px", color: "#000" }}>
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
                            padding: "10px",
                            fontSize: "15px",
                            fontFamily: "Arial, sans-serif",
                            outline: "none",
                            color: "#000",
                          }}
                        />
                      </div>
                    </>
                  ) : null}

                  <hr style={{ border: "none", borderTop: "1px solid #d1d5db", margin: 0 }} />

                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#000" }}>Total items: {totalItems}</div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={() => setShowMobileDrawer(false)}
                      style={{
                        flex: 1,
                        padding: "14px 16px",
                        fontSize: "16px",
                        borderRadius: "12px",
                        border: "1px solid #d1d5db",
                        background: "#f3f4f6",
                        color: "#000",
                        cursor: "pointer",
                        fontWeight: 700,
                        minHeight: "48px",
                      }}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={handleMobileSave}
                      style={{
                        flex: 1,
                        padding: "14px 16px",
                        fontSize: "16px",
                        borderRadius: "12px",
                        border: "1px solid #86efac",
                        background: "#dcfce7",
                        color: "#000",
                        cursor: "pointer",
                        fontWeight: 700,
                        minHeight: "48px",
                      }}
                    >
                      Save Order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      );
    }

    // ── Desktop compose-order layout (unchanged) ──
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
        <TopBar mode={mode} onChange={switchMode} disabled>
          <ClearAllButton onClick={() => setShowResetModal(true)} />
        </TopBar>
        {showResetModal && <ResetModal onClose={() => setShowResetModal(false)} onConfirm={clearAllState} />}

        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "8px",
            justifyContent: "center",
            alignItems: "center",
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
                borderRadius: "10px",
                boxShadow: "0 1px 6px rgba(0,0,0,0.10)",
                border: "1px solid #d1d5db",
                textAlign: "center",
                background: stat.bg,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "1px",
                flexShrink: 0,
                padding: "3px 12px",
              }}
            >
              <div style={{ color: "#000", fontSize: "9px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                {stat.label}
              </div>
              <div style={{ fontSize: "19px", fontWeight: 800, color: "#000", lineHeight: 1 }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginBottom: "8px",
            display: "flex",
            gap: "10px",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "4px",
          }}
        >
          {kitchenSummary.length === 0 ? (
            <div style={{...cardStyle, padding: "6px 10px", border: "1px solid #d1d5db", color: "#000", fontSize: "13px", flexShrink: 0}}>No active items</div>
          ) : (
            kitchenSummary.map((group, gi) => {
              const colors = ["#dbeafe","#dcfce7","#fef9c3","#ffedd5","#e0e7ff","#f3e8ff","#d1fae5","#fee2e2","#e0f2fe","#fef3c7","#ede9fe","#fce7f3"];
              const hc = colors[gi % colors.length];
              return (
              <div key={group.categoryLabel} style={{...cardStyle, border: "1px solid #d1d5db", flexShrink: 0, minWidth: "160px", display: "flex", flexDirection: "column"}}>
                <div style={{fontWeight:800,fontSize:"11px",color:"#000",padding:"4px 10px",background:hc,borderRadius:"18px 18px 0 0",borderBottom:"1px solid #d1d5db",textAlign:"center",letterSpacing:"0.3px"}}>{group.categoryLabel}</div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap",padding:"6px 8px"}}>
                  {group.items.map(item => (
                    <div key={item.name} style={{padding:"4px 8px",borderRadius:"999px",background:"#f3f4f6",border:"1px solid #d1d5db",fontWeight:700,color:"#000",fontSize:"12px",lineHeight:1.2}}>{item.name} • {item.qty}</div>
                  ))}
                </div>
              </div>
            );})
          )}
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
                    background: orderStatus === "NEW"
                      ? "rgba(239,68,68,0.06)"
                      : orderStatus === "IN PREPARATION"
                        ? "rgba(249,115,22,0.06)"
                        : orderStatus === "READY"
                          ? "rgba(34,197,94,0.06)"
                          : orderStatus === "PICKED"
                            ? "#e5e7eb"
                            : "white",
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
                    {order.allKitchenItems.map((item, index) => {
                      const itemStatusStyle = getStatusColors(item.status);

                      return (
                        <button
                          key={`${order.id}-${item.name}-${index}`}
                          onClick={() => cycleLineStatus(order.table, order.id, item.lineId)}
                          style={{
                            border: "1px solid #d1d5db",
                            width: "100%",
                            cursor: "pointer",
                            textAlign: "left",
                            borderRadius: "12px",
                            padding: "10px",
                            background:
                              item.status === "NEW"
                                ? "rgba(239,68,68,0.08)"
                                : item.status === "IN PREPARATION"
                                  ? "rgba(249,115,22,0.08)"
                                  : item.status === "READY"
                                    ? "rgba(34,197,94,0.08)"
                                    : item.status === "PICKED"
                                      ? "#e5e7eb"
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
                      onClick={() => {
                        const key = `${order.table}-${order.id}`;
                        if (confirmDone[key]) {
                          setConfirmDone((prev) => ({ ...prev, [key]: false }));
                          setOrderItemsStatus(order.table, order.id, "PICKED UP", "kitchen");
                        } else {
                          setConfirmDone((prev) => ({ ...prev, [key]: true }));
                          setTimeout(() => {
                            setConfirmDone((prev) => {
                              if (prev[key]) return { ...prev, [key]: false };
                              return prev;
                            });
                          }, 5000);
                        }
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: confirmDone[`${order.table}-${order.id}`] ? "1px solid #fca5a5" : "1px solid #d1d5db",
                        background: confirmDone[`${order.table}-${order.id}`] ? "#fef2f2" : "#e5e7eb",
                        color: confirmDone[`${order.table}-${order.id}`] ? "#991b1b" : "#000",
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: "13px",
                      }}
                    >
                      {confirmDone[`${order.table}-${order.id}`] ? "Click to confirm" : "Mark all DONE"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        
      </div>
    );
  }

if (mode === "reception") {
    return (
      <div style={{ ...pageStyle, padding: "10px 14px" }}>
        <TopBar mode={mode} onChange={switchMode} disabled />

        <div style={{ fontSize: "16px", fontWeight: 800, color: "#000", marginBottom: "14px" }}>
          History 24h ({receptionOrders.length})
        </div>

        <div className="reception-cards-grid">
          {receptionOrders.length === 0 ? (
            <div
              className="reception-empty-card"
              style={{ ...cardStyle, padding: "20px", color: "#000", border: "1px solid #d1d5db" }}
            >
              No orders in this view
            </div>
          ) : (
            (() => {
              // Group orders by table + room — each group becomes one card
              const groups = {};
              receptionOrders.forEach((order) => {
                const key = `${order.table}-${order.room}`;
                if (!groups[key]) {
                  groups[key] = { table: order.table, room: order.room, orders: [] };
                }
                groups[key].orders.push(order);
              });

              return Object.values(groups).map((group) => {
                // Sort orders within group chronologically
                const sorted = group.orders.sort((a, b) => a.createdAt - b.createdAt);

                // Merge all items from all orders in the group, preserving order
                const allItems = sorted.flatMap((order) =>
                  order.items.map((item) => ({
                    ...item,
                    orderId: order.id,
                    _createdAt: order.createdAt,
                  }))
                );

                // Find earliest creation time
                const firstCreatedAt = sorted[0].createdAt;

                return (
                  <div
                    key={group.table + group.room}
                    className="reception-card"
                    style={{
                      ...cardStyle,
                      border: "1px solid #d1d5db",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      minWidth: 0,
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "8px",
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: "clamp(13px, 1.4vw, 18px)",
                            fontWeight: 800,
                            color: "#000",
                            lineHeight: 1.25,
                          }}
                        >
                          {group.room} • Table {group.table}
                        </div>
                        <div
                          style={{
                            color: "#555",
                            marginTop: "2px",
                            fontSize: "clamp(11px, 1vw, 13px)",
                            fontWeight: 600,
                          }}
                        >
                          {formatElapsed(firstCreatedAt, now)}
                        </div>
                      </div>
                    </div>

                    <div
                      className="reception-card-items"
                      style={{
                        padding: "10px",
                        background: "#fafafa",
                        border: "1px solid #e5e7eb",
                        borderRadius: "10px",
                        color: "#000",
                      }}
                    >
                      {allItems.map((item, idx) => {
                        const checklistKey = `${item.orderId}-${item.name}`;
                        const isChecked = receptionChecklist[checklistKey];
                        return (
                          <div
                            key={`${item.orderId}-${item.name}-${idx}`}
                            onClick={() => toggleReceptionItem(item.orderId, item.name)}
                            style={{
                              fontSize: "clamp(13px, 1.2vw, 15px)",
                              lineHeight: 1.45,
                              marginBottom: "3px",
                              cursor: "pointer",
                              textDecoration: isChecked ? "line-through" : "none",
                              opacity: isChecked ? 0.55 : 1,
                              userSelect: "none",
                            }}
                          >
                            <span style={{ fontWeight: 800 }}>{item.qty}x </span>
                            <span>{item.name}</span>
                            {(item.extras || []).map((extra) => (
                              <span key={extra} style={{ fontSize: "clamp(11px, 1vw, 13px)", color: "#555", display: "block", paddingLeft: "14px", fontWeight: 600 }}>
                                * {extra}
                              </span>
                            ))}
                            {item.note ? (
                              <span style={{ fontSize: "clamp(11px, 1vw, 13px)", color: "#555", display: "block", paddingLeft: "14px" }}>
                                Note: {item.note}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>
        
      </div>
    );
  }

  return null;
}

export default App;
