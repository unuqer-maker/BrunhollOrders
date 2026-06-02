import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

try {
  enableIndexedDbPersistence(db).catch(() => {
    // Offline persistence not available — online-only mode
  });
} catch {
  // Browser doesn't support IndexedDB persistence
}

export const STATE_COLLECTION = "state";
export const ORDER_DOC = "orders";
export const ROOM_DOC = "rooms";
export const BARQUEUE_DOC = "barQueue";

function stateDoc(name) {
  return doc(db, STATE_COLLECTION, name);
}

/**
 * Save one state slice to Firestore.
 * @param {"orders"|"rooms"|"barQueue"} name
 * @param {object} data
 */
export async function saveState(name, data) {
  try {
    await setDoc(
      stateDoc(name),
      {
        ...data,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn(`Firestore saveState(${name}) failed:`, err);
  }
}

/**
 * Subscribe to a single state document. Calls back with the document data
 * (without updatedAt). If the document doesn't exist yet, calls with null.
 * @param {"orders"|"rooms"|"barQueue"} name
 * @param {(data: object|null) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribeState(name, callback) {
  return onSnapshot(
    stateDoc(name),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Remove metadata fields before passing to app
        const { updatedAt, ...state } = data;
        callback(state);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn(`Firestore subscribeState(${name}) error:`, err);
    }
  );
}

// ── localStorage cache ──────────────────────────────────────────────

const STORAGE_KEY = "brunholl_v1";

export function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== 1) return null;
    return {
      ordersByTable: data.ordersByTable || {},
      roomsByTable: data.roomsByTable || {},
      barQueueState: data.barQueueState || {},
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveLocalState(ordersByTable, roomsByTable, barQueueState) {
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
    // Storage full or unavailable
  }
}