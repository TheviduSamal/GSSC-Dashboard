import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database'; // <-- මේක වෙනස් කළා

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
export const db = getDatabase(app); // <-- මේක Realtime Database එකට හැරෙව්වා