import type { Analytics } from "firebase/analytics";

import { firebaseApp } from "./app";

let analyticsPromise: Promise<Analytics | null> | null = null;

export function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  analyticsPromise ??= import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported }) => {
      if (!(await isSupported())) {
        return null;
      }

      return getAnalytics(firebaseApp);
    })
    .catch(() => null);

  return analyticsPromise;
}
