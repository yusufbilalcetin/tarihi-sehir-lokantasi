import type { FirebaseOptions } from "firebase/app";

const requiredFirebaseEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

export const firebaseConfig: FirebaseOptions = {
  apiKey: requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: requiredFirebaseEnvironment.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export function getFirebaseConfig(): FirebaseOptions {
  const missingVariables = Object.entries(requiredFirebaseEnvironment)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(
      `[Firebase] Missing required environment variables: ${missingVariables.join(
        ", ",
      )}. Add them to .env.local or your deployment environment.`,
    );
  }

  return firebaseConfig;
}
