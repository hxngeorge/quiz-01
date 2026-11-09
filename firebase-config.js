/* =========================================================================
   QUIZ://01 — YOUR SETTINGS
   -------------------------------------------------------------------------
   This is the ONLY file you need to edit. Replace the placeholder values
   below with your own. Full instructions are in README.md.

   The game works before you fill anything in: it uses sample questions and
   sample players, and scores aren't saved. Once Firebase is filled in, real
   scores start saving and the leaderboard goes live.
   ========================================================================= */


/* -------------------------------------------------------------------------
   1. FIREBASE — where everyone's scores are stored
   -------------------------------------------------------------------------
   Where to find these:
     1. Go to console.firebase.google.com and create a free project
     2. Inside it, create a Firestore Database (start in test mode)
     3. Project settings → General → "Your apps" → add a Web app
     4. Copy the values it shows you into the lines below

   Leave this as it is and the game runs on sample players instead.
   ------------------------------------------------------------------------- */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCrFl1Xz7Rc0NsomltPhhYHwmhhQFMC9DY",
  authDomain:        "quiz-01-ad4a7.firebaseapp.com",
  projectId:         "quiz-01-ad4a7",
  storageBucket:     "quiz-01-ad4a7.firebasestorage.app",
  messagingSenderId: "1022716256389",
  appId:             "1:1022716256389:web:7e7c8ef6ac9273d2e809ec"
};


/* -------------------------------------------------------------------------
   2. GOOGLE SHEET — where you write each day's questions
   -------------------------------------------------------------------------
   Setting it up:
     1. Go to sheets.new, then File → Import → Upload → choose
        sample-sheet.xlsx (in this folder) → "Create new spreadsheet".
        You get the right headings plus three example rows, laid out so you
        only see each question's text, type and points. Click the + beside
        "points" to open that question's answers, options A-D and picture.
        (If the import loses the layout, sample-sheet.csv holds the same
        columns as plain text — import that instead, and in the import
        box UNTICK "Convert text to numbers, dates, and formulas".)
     2. Click Share → General access → "Anyone with the link" → Viewer.
        (You do NOT need "Publish to web".)
     3. Copy the long ID out of the sheet's web address:
          docs.google.com/spreadsheets/d/  THIS_LONG_BIT  /edit
        and paste it below.

   OPEN THE QUIZ FROM A WEB ADDRESS, not by double-clicking index.html.
   Google refuses to hand the Sheet to a page opened straight from a file,
   so a double-clicked page quietly plays the three built-in sample
   questions (and says "SAMPLE QUIZ" on screen). Your hosted site, or
   http://localhost:8000 after running  python3 -m http.server 8000  in
   this folder, both work.

   Keep the "Questions" tab first, and don't rename or remove any column
   heading: the game finds each column by its heading. The "month" column
   works itself out from the date (it's there so you can filter by month),
   so don't type in it. Extra columns of your own are ignored.

   One row per day. A row only reaches players when its status is "live"
   and its date is today's date (YYYY-MM-DD). Use "draft" while you're
   still writing; open  index.html?preview=true  to rehearse a draft.

   For a multiple-choice question, put the right answer's letter (A–D) or
   its exact text in the answers column.

   TYPED QUESTIONS WITH SEVERAL PARTS (e.g. "Name the two planets closest
   to the Sun"), each part with its own points:
       points:   2+2
       answers:  mercury | venus
   - Separate the parts with  |  in the answers cell, and give one number
     per part, joined with  +  in the points cell. Mismatched counts make
     the row count as filled in wrong.
   - Inside one part, commas are alternative spellings:
     "mercury,Mercury | venus".
   - The player gets one box per part. The order they type in doesn't matter,
     they can leave a box empty, and the same answer can't score twice.
     Each part they get right earns its own points: 2+2 gives 4 for both,
     2 for one. (A question with one answer and one number works as it always
     has. Up to 4 parts. Multiple-choice questions can't have parts.)
   - Keep the question columns formatted as Plain text, as the template has
     them. If Sheets treats a bare number such as 366 as a number, it can
     hand the game an empty cell instead.

   PICTURE QUESTIONS: the q1_image / q2_image / q3_image columns are
   optional. Leave one blank for a normal question, or put in:
     - a file path:  images/q1.png   (put the file in the "images" folder
                     next to index.html — this is the most reliable way)
     - a Google Drive share link (the file must be shared as "anyone with
                     the link"; paste the link exactly as Drive gives it)
     - any direct image address starting with https://
   Players can read an image's address in their browser, so give files
   neutral names (q1.png, not eiffel-tower.png).

   Leave this as it is and the game uses its three built-in sample
   questions. Anything left wrong in a live row means "no quiz today"
   rather than the wrong quiz — press F12 and look at the Console to see
   which cell it's unhappy with.
   ------------------------------------------------------------------------- */
const SHEET_ID = "1U5_8S5xwcRrpcdD_VLxrp8pu06FU8SHdH5-Fzodqt4k";


/* -------------------------------------------------------------------------
   3. ADMIN PASSWORD — unlocks admin.html
   -------------------------------------------------------------------------
   IMPORTANT: anyone who views this page's source can read this password.
   It only keeps casual visitors out — never reuse a real password here.
   ------------------------------------------------------------------------- */
const ADMIN_PASSWORD = "BonJo1234";


/* -------------------------------------------------------------------------
   4. RECORD PLAYERS' IP ADDRESSES?
   -------------------------------------------------------------------------
   true  → each score is saved with the player's IP address, which helps you
           spot someone playing twice from two browsers.
   false → no IP is collected.

   An IP address is personal data in many places (the UK and EU included).
   If you turn this on, tell your players, and remember that anyone who can
   read your database can read the IPs too. false is the safer default.
   ------------------------------------------------------------------------- */
const STORE_IP = false;
