import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Server-only — never imported from a "use client" component. Holds the one Admin SDK app
// instance for the life of the process, same pattern as this codebase's other server-side
// singletons (e.g. lib/footballData.ts's module-level caches): re-initializing on every request
// would just waste work, and the Admin SDK itself warns if you try to init twice.
let app: App | null = null;

function getAdminApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // The private key comes from a downloaded JSON file where it's already `\n`-escaped for JSON —
  // most ways of getting it into an env var (a .env file, a hosting provider's secret UI) keep it
  // as a literal `\n`-containing string rather than a real multi-line value, so it has to be
  // un-escaped back into actual newlines here or the PEM parser rejects it.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    );
  }

  app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return app;
}

export function getDb(): Firestore {
  return getFirestore(getAdminApp());
}
