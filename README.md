# NextFocus — Web App and Chrome Extension

NextFocus turns goals into executable actions and gives you one thing to focus on today.

## Website deployment (GitHub Pages)

The website is a static site with no build step. The repository root `index.html` forwards visitors to the marketing landing page in `nextfocus-landing/`. Its **Get Started** actions open `app.html`. Sign-in and account creation also return directly to `app.html`.

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose the branch and `/ (root)` folder, then save.
4. In Firebase Console, add the published GitHub Pages hostname (for example, `username.github.io`) under **Authentication → Settings → Authorized domains**.
5. Test the landing page, app, offline storage, and Firebase sign-in at the published URL.

The site stores offline data and authentication state in the browser's `localStorage`, scoped to the website origin. The Chrome extension uses `chrome.storage.local`; those stores are separate. Users can access the same account data in both by signing in and syncing through Firebase.

Do not put private API keys in client-side files. AI suggestions remain disabled in this build until a private backend is configured. The Gemini key that was previously in the source should be revoked/rotated in Google AI Studio. Firebase's Web API key is client configuration; restrict data access with Firebase Authentication and Firestore Security Rules.

## Chrome extension

The extension opens `app.html` directly and does not show the marketing landing page. To load it locally:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.

For Chrome Web Store distribution, package the extension separately and submit it through the Chrome Web Store developer dashboard.

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

Each signed-in user gets six documents:

```text
users/{uid}/data/goals
users/{uid}/data/tasks
users/{uid}/data/ideas
users/{uid}/data/plans
users/{uid}/data/journal
users/{uid}/data/habits
```

Each document stores that section as a versioned JSON payload. This keeps the extension's domain model independent from Firestore-specific data types.

## The 5 Mental Activities

NextFocus organizes your workflow into 5 distinct mental spaces:

- 💭 **IDEAS** — Things I might do (fast capture, no commitment)
- 🎯 **LATER** — Things I decided to accomplish (goals & outcomes)
- 📥 **NEXT** — Things I have prepared to do (curated queue of max 7 executable tasks)
- ⭐ **TODAY** — The one thing I'm doing now (one main focus task + up to 3 quick tasks)
- 📖 **JOURNAL** — Things I'm thinking about (frictionless daily reflection)
- 🔁 **HABITS** — Repeated behaviors with flexible schedules and low-pressure daily check-ins

## Habit tracking

Habits are separate from tasks and do not enter the NEXT or TODAY task queues. Create a do habit or an avoid habit, choose a daily, weekday, selected-day, or weekly-target schedule, and optionally link it to a goal. Do habits can include a normal and minimum version. Check-ins and weekly consistency are retained when a habit is paused or archived.

TODAY shows only active habits scheduled for that day as a small supporting check-in panel; the main task remains the primary focus.

## Frictionless Journal

A daily monologue space that connects thinking directly with your task system:

- **One continuous document per day:** write whatever is on your mind with no forced structure, moods, ratings, tags, or templates.
- **Direct entry:** opening Journal takes you straight into writing.
- **Automatic saving:** continuous background saving with zero popups or confirmation prompts.
- **Thought timestamps:** click **+ Add thought** or shortcuts (**Morning**, **During day**, **Evening**) to automatically insert the current time into the flow.
- **Personal timeline:** browse backward and forward with day-by-day navigation (`← Yesterday`, `Today`, `Tomorrow →`).
- **Today ↔ Journal context:** see today's planned and completed tasks right next to your reflections to capture real context on your work.


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
