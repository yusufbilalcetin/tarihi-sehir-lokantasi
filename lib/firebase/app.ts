import { getApp, getApps, initializeApp } from "firebase/app";

import { getFirebaseConfig } from "./config";

export const firebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
