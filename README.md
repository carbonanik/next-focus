# NextFocus — Chrome Extension

NextFocus turns goals into executable actions and gives you one thing to focus on today.

## V1.1 — Firebase sync + optional offline mode

The extension now has two modes:

- **Account mode:** email/password authentication with Firebase Authentication. Goals, tasks, ideas and daily plans are cached locally and synced to Cloud Firestore.
- **Offline mode:** choose **Skip — continue offline** and the extension behaves like the original local-only build using `chrome.storage.local`.

Uninstalling Chrome clears local extension storage. Account-mode data survives because it is stored in Firestore and is restored after reinstall + sign-in.

## Firebase setup

### 1. Create a Firebase project

Create a project in Firebase Console.

### 2. Enable Email/Password Authentication

Firebase Console → **Authentication** → **Sign-in method** → enable **Email/Password**.

### 3. Create Cloud Firestore

Firebase Console → **Firestore Database** → create a database.

### 4. Add Firestore Security Rules

Copy the contents of `firestore.rules` into Firebase Console → Firestore → Rules and publish them.

The included rules only allow an authenticated user to read/write their own path:

```text
/users/{uid}/data/{section}
```

### 5. Add Firebase configuration

Edit:

```text
src/infrastructure/firebase.config.js
```

and replace:

```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  projectId: "YOUR_FIREBASE_PROJECT_ID"
};
```

You can find these values in Firebase Console → Project settings.

This build uses Firebase REST APIs, so there is no Firebase SDK, CDN script, npm install or bundling step.

## Data model in Firestore

Each signed-in user gets four documents:

```text
users/{uid}/data/goals
users/{uid}/data/tasks
users/{uid}/data/ideas
users/{uid}/data/plans
```

Each document stores that section as a versioned JSON payload. This keeps the extension's domain model independent from Firestore-specific data types.

## Offline → account migration

If you use NextFocus in offline mode first and later sign in:

- if the Firebase account already has cloud data, the cloud workspace is restored;
- if the Firebase account is empty, the existing offline workspace is copied to the account and uploaded automatically;
- the original guest/offline workspace remains separate.

## Local-first behavior for signed-in users

Account mode still writes to a UID-scoped `chrome.storage.local` cache first. Cloud writes happen after the local write. If Firebase cannot be reached, the changed section is marked pending and retried on a later launch.

This means a temporary connection problem does not block creating or completing tasks.

## Replace Firebase with your API later

The application layer does not call Firestore directly.

```text
UI
 ↓
Application / taskService
 ↓
storageRepository (local-first facade)
 ↓                  ↓
Chrome local cache  cloudStore provider
                       ↓
                 FirebaseCloudStore
```

The provider boundary is:

```text
src/infrastructure/cloudStore.js
```

When your API is ready, create an `ApiCloudStore` implementing the same operations (`getSection`, `saveSection`, `getAll`) and change the export in `cloudStore.js`.

Authentication is also isolated in:

```text
src/infrastructure/auth.js
```

The UI only consumes the repository methods such as `signIn`, `createAccount`, `signOut`, `skipLogin`, `getAccessState` and `getIdToken`. Replace that implementation when your own auth API is ready.

## Install locally

1. Configure Firebase, or leave it unconfigured if you only want to test offline mode.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `focused-task-manager-extension` folder.

## Core workflow

```text
LATER → NEXT → TODAY → DONE
```

Core limits remain unchanged:

- NEXT: maximum 7 tasks
- TODAY: one main task
- TODAY quick tasks: maximum 3
- blocked tasks cannot become TODAY
- incomplete dependencies cannot enter NEXT
