import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
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

export const STATE_COLLECTION = "state";
export const ORDER_DOC = "orders";
export const ROOM_DOC = "rooms";
export const BARQUEUE_DOC = "barQueue";

function stateDoc(name) {
  return doc(db, STATE_COLLECTION, name);
}

/**
 * Recursively replace all undefined values with null so Firestore never rejects.
 */
function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => (v === undefined ? null : v)));
}

/**
 * Save one state slice to Firestore.
 * @param {"orders"|"rooms"|"barQueue"} name
 * @param {object} data
 */
export async function saveState(name, data) {
  try {
    const safe = stripUndefined(data);
    await setDoc(
      stateDoc(name),
      {
        ...safe,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error(`[FIRESTORE] saveState(${name}) failed:`, err);
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
        const { updatedAt, ...state } = data;
        callback(state);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error(`[FIRESTORE] subscribeState(${name}) error:`, err);
    }
  );
}