import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

// ═══════════════════════════════════════════════════════════════════════════
// PRIMARY FIREBASE APP (Outflow / Main Dashboard)
// ═══════════════════════════════════════════════════════════════════════════
export const firebaseConfig = {
  apiKey: "AIzaSyDJMZcj61Kt5Iz0yvnaKKdbfDGt7rxefPs",
  authDomain: "outflow-offline-validation.firebaseapp.com",
  databaseURL: "https://outflow-offline-validation-default-rtdb.firebaseio.com",
  projectId: "outflow-offline-validation",
  storageBucket: "outflow-offline-validation.firebasestorage.app",
  messagingSenderId: "959205697048",
  appId: "1:959205697048:web:5d349f12bfe6a3e2f6c56d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// ═══════════════════════════════════════════════════════════════════════════
// SECONDARY FIREBASE APP (Verbal Warning — Separate Project)
// ═══════════════════════════════════════════════════════════════════════════
const verbalWarningConfig = {
  apiKey: 'AIzaSyADSorTM_rKEAhbFrNxEiujO0q3Yl8KPx8',
  authDomain: 'verbal-warning.firebaseapp.com',
  // ⚠️ IMPORTANT: Firebase Console > Realtime Database > URL එක copy කරන්න
  databaseURL: 'https://verbal-warning-default-rtdb.firebaseio.com',
  projectId: 'verbal-warning',
  storageBucket: 'verbal-warning.firebasestorage.app',
  messagingSenderId: '510969942216',
  appId: '1:510969942216:web:4fadc2d0feb9c297df15fd',
  measurementId: 'G-CLCZ5BY0F5',
};

// Named app instance — double-init (HMR) නවත්තනවා
const verbalWarningApp = getApps().find((a) => a.name === 'verbalWarning')
  ? getApp('verbalWarning')
  : initializeApp(verbalWarningConfig, 'verbalWarning');

export const verbalWarningDb = getDatabase(verbalWarningApp);