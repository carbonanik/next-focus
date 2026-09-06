// Firebase Web API configuration used by the REST adapters.
// The Web API key is a client identifier, not a server secret. Protect user data with Firestore Security Rules.
export const firebaseConfig = {
  apiKey: "AIzaSyCzCSuj3Tb79fhhCLm0k32MoED31WNrcPY",
  projectId: "next-focus"
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    !firebaseConfig.projectId.startsWith("YOUR_")
  );
}
