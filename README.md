
SideQues
A daily multiplayer quiz you share with a friend group. Everyone answers the same three questions, the fastest correct answers win, and a live leaderboard tracks today's winner and everyone's all-time total.

Pure HTML, CSS and JavaScript — no installs, no build step, no framework. Open index.html in a browser and it runs.

Contents
What you get out of the box
Running it locally
Setting up Firebase (saves scores, live leaderboard)
Turning on Google sign-in
Setting up the Google Sheet (today's questions)
The admin panel
Putting it online
Securing your database before test mode expires
File structure
Troubleshooting
What you get out of the box
Nothing needs to be configured before you can look at the game — open index.html and it plays three sample questions with made-up leaderboard names, so you can see the whole thing end to end before connecting anything real.

Once you fill in firebase-config.js (the only file you ever need to edit), it becomes the real thing:

Questions come from a Google Sheet you edit daily — typed answers, multiple choice, questions with several parts worth separate points each, and optional pictures.
Scores are saved to Firebase, with a live "today" leaderboard (sorted by points, ties broken by speed) and an all-time leaderboard across every day played.
One play per person per day, enforced per browser.
An admin panel (admin.html) behind a password, where you check today's questions are filled in correctly before anyone plays, and manage the leaderboard.
If you never touch firebase-config.js at all, the game still works — it just plays the same three sample questions every day and doesn't save anything.

Running it locally
Don't just double-click index.html. That opens it as a file:// address, and browsers refuse to let a page like that talk to Google Sheets or Firebase — you'd only ever see the sample quiz, with a pink banner saying so.

Instead, serve the folder over a real (if local) web address. From inside the quiz-01 folder:

python3 -m http.server 8000
Then open http://localhost:8000 in your browser (and http://localhost:8000/admin.html for the admin panel). This works with no installs on a Mac or Linux machine; python3 ships with the OS.

Setting up Firebase
Firebase is what stores everyone's scores. It's free for a friend group's daily traffic.

Go to console.firebase.google.com, sign in with any Google account, and click Create a project. Name it anything. When it offers Google Analytics, turn it off — you don't need it.

In the left sidebar: Build → Firestore Database → Create database.

Choose Standard edition.
Pick a location close to your players. This can't be changed later.
For the security rules step, choose test mode (see Securing your database below — you'll want to revisit this before it expires).
Click the gear icon → Project settings, scroll to Your apps, click the web icon (</>), give it any nickname, and don't tick "Firebase Hosting". Click Register app.

You'll see a firebaseConfig object with six values. Copy them into firebase-config.js:

const FIREBASE_CONFIG = {
  apiKey:            "...",
  authDomain:        "...",
  projectId:         "...",
  storageBucket:     "...",
  messagingSenderId: "...",
  appId:             "..."
};
That's it — reload the page (served over http://, not double-clicked). One more step below turns on sign-in, which is what actually lets a score save.

The API key isn't a secret. Every Firebase web app ships it in plain sight in its page source; it only identifies which project to talk to. Your data is protected by the security rules you set in step 2, not by hiding this key.

Turning on Google sign-in
Scores only ever save for a signed-in player — this is what the whole identity system is built on, so it needs turning on once per project.

In the Firebase console: Build → Authentication → Get started.
Open the Sign-in method tab, click Google in the provider list, toggle it Enable, pick a support email (any email on the project works), and click Save.
Still under Authentication, open Settings → Authorized domains. localhost is already there for local testing; once you've put this online, add that address here too (e.g. yourname.github.io or your-project.vercel.app) — sign-in silently refuses to work on a domain that isn't listed.
That's the only setup Google sign-in needs — no extra values in firebase-config.js, since it reuses the same project you already connected above.

Setting up the Google Sheet
This is where you write each day's three questions.

Go to sheets.new, then File → Import → Upload and choose sample-sheet.xlsx from this folder → Create new spreadsheet. You get the right column headings plus a few example rows, laid out so you only see each question's text, type and points at a glance — click the + beside "points" to open that question's answers, options and picture.

If the import loses that layout, sample-sheet.csv has the same columns as plain text — import that instead, and in the import dialog untick "Convert text to numbers, dates, and formulas".
Share → General access → "Anyone with the link" → Viewer. You do not need "Publish to web".

Copy the long ID out of the sheet's address bar — docs.google.com/spreadsheets/d/THIS LONG BIT/edit — into firebase-config.js:

const SHEET_ID = "...";
How a row works
One row per day. Each of Q1, Q2 and Q3 has its own text, type (text or mcq), points, answers, opt_a–opt_d (multiple choice only) and an optional image.

A row only reaches players when its date is today's date and its status is live. Use draft while you're still writing it, and open index.html?preview=true to rehearse a draft yourself — a pink banner reminds you nothing in preview is saved.
Multiple choice: put the right answer's letter (A–D) or its exact text in answers.
A question with several parts worth separate points (e.g. "name both X and Y"): separate the parts with | in answers and give one number per part joined with + in points — mercury | venus and 2+2. Players get one box per part, in any order, and are scored on what they get right even if they only answer one part.
Pictures: put a file path (images/q1.png), a Google Drive share link, or any https:// address in the image column.
A row that's filled in wrong — a typo, a mismatched points count — shows players "no quiz today" rather than guessing. Open the admin panel to see exactly which cell it didn't like, before anyone else does.

If you never set SHEET_ID, or the Sheet can't be reached, the game quietly falls back to its three built-in sample questions, and says so on screen.

The admin panel
Open admin.html (served the same way as the game — not double-clicked) and sign in with the password in firebase-config.js:

const ADMIN_PASSWORD = "...";
This is not real security. It's a check that runs in your browser, and anyone who views the page's source can read this password. It only keeps casual visitors from poking at the Reset button — don't reuse a password you use anywhere else.

From there you can:

See every dated row in your Sheet and whether it reads correctly, with a full preview of exactly what players will see for the selected row.
See today's leaderboard live, export it as a CSV, remove a single player's score, or reset the whole day (this never touches anyone's all-time total).
Switch between dark and light mode, independent of the game (which is always dark).
Putting it online
Once you've checked it locally, host it somewhere with a real address so your friend group can reach it from their phones. Two free options that need no build step:

GitHub Pages
Push this folder to a GitHub repository.
In the repo: Settings → Pages → Source → Deploy from a branch, pick your main branch and the root folder, then Save.
GitHub gives you an address like https://yourname.github.io/quiz-01/.
Vercel
Go to vercel.com, sign in, Add New → Project, and import the same GitHub repository.
Leave every build setting blank/default — there's nothing to build. Click Deploy.
Vercel gives you an address immediately, and redeploys automatically whenever you push.
Either way, share that one address with your friends. They don't need anything installed — just the link, once a day.

Securing your database before test mode expires
When you created your Firestore database, "test mode" rules let anyone read and write anything in your project, but only for 30 days — after that, every request is silently refused and the whole app stops saving scores, with no warning to your players.

Before that date, open Firestore Database → Rules in the Firebase console and replace the test-mode rules with these, which only allow access to the two collections this app actually uses:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /daily/{date}/scores/{uid} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == uid;
      allow delete: if true;   // lets the admin panel's Remove button work
    }
    match /alltime/{uid} {
      allow read: if true;
      allow create, update: if request.auth != null && request.auth.uid == uid;
      allow delete: if true;   // lets the admin panel's Remove button work
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
Click Publish. This doesn't expire, and it keeps anyone who discovers your API key from reading or writing anything outside the leaderboard data itself.

Why writes are keyed to the signed-in player: a score can only ever be written by the Google account it belongs to (request.auth.uid == uid) — a guest who skips signing in never writes anything at all. Deletes stay open so the admin panel's Remove buttons keep working without needing their own sign-in; that's the same trust the admin password already relies on.

Why today's score only allows create, not update: once a player's daily score document exists, nothing — not even their own account — can overwrite it. That's what actually stops the same account from playing twice in one day and double-counting their all-time total, even if they switch devices partway through. (The app also checks this itself before showing the "ready to embark" button, so a second device shows "already played" straight away — this rule is the backstop for if that check is ever wrong or skipped, not the only thing standing in the way.) The all-time totals document stays on create, update since it's meant to change every day, just never for the same day twice.

File structure
File	What it is
index.html	The game players see
admin.html	The admin panel
style.css	All of the game's styling (the admin panel styles itself, inline)
app.js	All game logic — also loaded by admin.html, so both pages read the Sheet and Firebase exactly the same way
admin.js	Admin panel logic
firebase-config.js	The only file you edit — your Firebase project, Sheet ID, admin password
sample-sheet.xlsx / sample-sheet.csv	Ready-made Sheet templates with the right columns
images/	Put your own question pictures here
Troubleshooting
"SAMPLE QUIZ · SHEET NOT REACHED" / the leaderboard never has real players. Almost always means the page was opened as a file:// address (double-clicked) rather than served over http:// — see Running it locally. Open the browser's console (F12) for the exact reason if that's not it.

A row I wrote shows "no quiz today". Open the admin panel — it shows every row and the precise reason a broken one won't reach players (a typo in type, a mismatched points/answers count, a missing multiple-choice option).

Scores stopped saving one day, with no changes on your end. Your Firestore test-mode rules expired — see Securing your database.

A player says they can't play again today. That's by design — one play per browser per day. Add ?reset=true to the game's address to clear it while testing; there's no way for a player to do this to replay for real.

