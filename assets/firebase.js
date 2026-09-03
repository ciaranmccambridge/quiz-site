// Firestore wiring: the only shared storage in an otherwise fully static site.
//
// The whole app degrades gracefully without this. Leave the config blank and the
// quiz still runs end to end against localStorage -- you just don't get a shared
// leaderboard. That's deliberate, so the round can be built and tested before
// any cloud account exists.

// ============================================================================
// PASTE YOUR FIREBASE CONFIG HERE
// ============================================================================
// Firebase console -> Project settings -> Your apps -> Web app -> SDK setup.
//
// These values are MEANT to be public; Firebase web keys identify a project,
// they don't authorise access. Safety comes from firestore.rules, not from
// hiding this. Committing it to a public repo is correct, not an oversight.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA7Q7p_8JtbxbqhATc_4KGcMDbKW8Cpjas',
  authDomain: 'ciarans-quiz.firebaseapp.com',
  projectId: 'ciarans-quiz',
  storageBucket: 'ciarans-quiz.firebasestorage.app',
  messagingSenderId: '361116539011',
  appId: '1:361116539011:web:a94c825f4b1a6eb3ba63b6',
};

// Pinned deliberately. Verified available on the gstatic CDN.
const SDK_VERSION = '12.18.0';

/** With no config we run local-only; the UI uses this to explain itself. */
export const isConfigured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);

// The Firebase web SDK is browser-only -- it's imported from a CDN over https,
// which node's ESM loader refuses outright. Guarding on this keeps the node test
// harness from attempting a doomed import (and logging a stack trace) on every
// single save. `document` is no good as a check: the test shim defines it.
const IN_BROWSER = typeof window !== 'undefined';

// Cached so repeated saves don't re-import or re-initialise.
let sdkPromise = null;

function loadSdk() {
  if (!sdkPromise) {
    // Imported dynamically rather than at the top of the file so that an
    // unconfigured, offline setup makes no network requests at all.
    sdkPromise = (async () => {
      const [{ initializeApp }, firestore] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
      ]);

      const app = initializeApp(FIREBASE_CONFIG);
      return { firestore, db: firestore.getFirestore(app) };
    })();
  }

  return sdkPromise;
}

// quiz/{sessionId}/submissions/{playerId} -- four segments, so `submissions` is
// a subcollection and each session's results stay isolated. Bumping SESSION_ID
// in quiz-data.js therefore gives a clean slate without deleting anything.
function submissionsPath(sessionId) {
  return ['quiz', sessionId, 'submissions'];
}

/**
 * Upsert one player's progress. Called after every question rather than only at
 * the end, so someone who wanders off mid-round still leaves usable data.
 * Returns true on success; never throws, because a failed sync must not block
 * the player from continuing.
 */
export async function saveProgress(sessionId, playerId, payload) {
  if (!isConfigured || !IN_BROWSER) return false;

  try {
    const { firestore, db } = await loadSdk();
    const ref = firestore.doc(db, ...submissionsPath(sessionId), playerId);

    await firestore.setDoc(
      ref,
      { ...payload, updatedAt: firestore.serverTimestamp() },
      { merge: true }
    );

    return true;
  } catch (error) {
    console.error('Could not save progress to Firestore.', error);
    return false;
  }
}

/**
 * Live-subscribe to every submission in a session.
 * @param onData  called with an array of submission objects on every change
 * @param onError called with an Error if the subscription fails
 * @returns unsubscribe function
 */
export async function subscribeToSubmissions(sessionId, onData, onError) {
  if (!isConfigured) {
    onError?.(new Error('Firebase is not configured.'));
    return () => {};
  }

  if (!IN_BROWSER) {
    onError?.(new Error('The Firebase SDK only loads in a browser.'));
    return () => {};
  }

  try {
    const { firestore, db } = await loadSdk();
    const ref = firestore.collection(db, ...submissionsPath(sessionId));

    return firestore.onSnapshot(
      ref,
      (snapshot) => onData(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (error) => {
        console.error('Leaderboard subscription failed.', error);
        onError?.(error);
      }
    );
  } catch (error) {
    console.error('Could not subscribe to Firestore.', error);
    onError?.(error);
    return () => {};
  }
}
