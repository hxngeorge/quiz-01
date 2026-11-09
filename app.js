/* =========================================================================
   QUIZ://01 — PLAYER APP LOGIC
   -------------------------------------------------------------------------
   What's working so far (STEPS 2-6, plus picture and multi-part questions):
     • today's date on screen
     • name input with validation
     • sound on/off, remembered between visits
     • 8-bit sound effects (no audio files — the browser makes the sounds)
     • replay blocking: one play per browser per day
     • moving between screens with a quick flash
     • the three questions, the clock, scoring and answer checking
     • results with today's rank, and the leaderboard (sample data for now)

     • Firebase: real scores, live leaderboard and player count
       (optional — without it the game runs on sample players)

     • Google Sheets: the daily questions, with draft preview and a
       built-in fallback quiz

   Still to come:
     STEP 7 → the admin panel (admin.html)
   ========================================================================= */


/* =========================================================================
   SETTINGS
   ========================================================================= */

// Names shorter or longer than this are rejected.
const NAME_MIN = 2;
const NAME_MAX = 20;

// The most answer parts one typed question can have (e.g. "name the two ...").
const MAX_PARTS = 4;

// Keys used in localStorage (this browser's own small storage).
const KEY_SOUND  = "soundEnabled";
const KEY_PLAYED = "quizPlayed_";   // + today's date, e.g. quizPlayed_2026-11-09
const KEY_SCORE  = "quizScore_";    // + today's date


/* =========================================================================
   SHARED STATE
   Everything the app needs to remember while it is open.
   ========================================================================= */
const state = {
  playerName: "",      // what the player typed
  soundOn: true,       // set properly by loadSoundPreference()

  questions: [],       // today's three questions
  current: 0,          // which one we're on (0, 1, 2)
  points: 0,           // points so far
  startedAt: 0,        // when question 1 appeared (milliseconds)
  elapsed: 0,          // final time in seconds, once the quiz ends
  tickTimer: null,     // the once-a-second clock update

  myEntry: null,       // this player's line on today's leaderboard
  boardTab: "today",   // which leaderboard tab is open

  // Where today's questions came from:
  //   "live"     a live row in the Google Sheet
  //   "preview"  a draft row, opened by the admin with ?preview=true
  //   "fallback" the built-in sample questions (no Sheet set up, or the
  //              Sheet couldn't be reached)
  //   "none"     the Sheet has nothing playable for today
  quizMode: "fallback",

  imagesPending: null, // while today's pictures are still downloading: a promise
  preloaded: [],       // keeps the downloaded pictures alive in memory
  starting: false      // true while a quiz is being set up (blocks double starts)
};


/* =========================================================================
   THE QUESTIONS
   -------------------------------------------------------------------------
   These sample questions are used until the Google Sheet is connected in
   STEP 6 — and as a safety net if the sheet can't be read.

   Each question has:
     text    — the question
     type    — "text" (they type it) or "mcq" (they pick one of four)
     answers — accepted answers, lower case, for "text" questions
     options — the four choices, for "mcq" questions
     correct — which option is right (0 = A, 1 = B, 2 = C, 3 = D)
     points  — what it's worth
   ========================================================================= */
const FALLBACK_QUESTIONS = [
  {
    text: "What is the capital of France?",
    type: "text",
    answers: ["paris"],
    points: 10
  },
  {
    text: "Which planet is closest to the Sun?",
    type: "mcq",
    options: ["Mercury", "Venus", "Mars", "Jupiter"],
    correct: 0,
    points: 15
  },
  {
    text: "How many sides does a hexagon have?",
    type: "text",
    answers: ["6", "six"],
    points: 20
  }
];

/* =========================================================================
   SAMPLE LEADERBOARD DATA
   -------------------------------------------------------------------------
   Stand-ins until Firebase is connected in STEP 5. The player's own run is
   added to today's list when they finish, so ranking can be checked now.
   ========================================================================= */
const MOCK_TODAY = [
  { name: "PIXEL_QUEEN", points: 45, time_seconds: 62,  time_display: "1m 2s" },
  { name: "ARCADE_ANNIE", points: 45, time_seconds: 88, time_display: "1m 28s" },
  { name: "BYTE_ME",     points: 30, time_seconds: 54,  time_display: "0m 54s" },
  { name: "NEON_NIK",    points: 25, time_seconds: 120, time_display: "2m 0s" },
  { name: "GLITCH",      points: 10, time_seconds: 240, time_display: "4m 0s" }
];

const MOCK_ALLTIME = [
  { name: "PIXEL_QUEEN", total_points: 310, days_played: 9 },
  { name: "BYTE_ME",     total_points: 240, days_played: 8 },
  { name: "ARCADE_ANNIE", total_points: 180, days_played: 5 },
  { name: "NEON_NIK",    total_points: 95,  days_played: 4 },
  { name: "GLITCH",      total_points: 40,  days_played: 2 }
];


/**
 * A typed question's answer parts, each with its own points. A question that
 * is just "one answer, one number" (the sample questions) is a single part.
 */
function partsOf(question) {
  return question.parts || [{ answers: question.answers, points: question.points }];
}

/** The highest score possible today — shown on the results screen. */
function maxPossiblePoints() {
  return state.questions.reduce(function (sum, q) {
    return sum + q.points;
  }, 0);
}


/* =========================================================================
   GOOGLE SHEETS — TODAY'S QUESTIONS
   -------------------------------------------------------------------------
   The admin writes each day's three questions in a Google Sheet (one row
   per day). This section downloads that sheet, finds today's row and turns
   it into the same question format as FALLBACK_QUESTIONS above.

   What happens in each situation:
     no Sheet ID filled in ........ built-in sample questions
     sheet can't be reached ....... built-in sample questions
     live row for today ........... that row's questions
     only a draft row for today ... "no quiz today", unless the admin opened
                                    the page with ?preview=true
     nothing for today ............ "no quiz today"
     a row that's filled in wrong . "no quiz today" (and the reason is
                                    written to the browser console), so
                                    players never get the wrong quiz

   The sheet must be shared as "Anyone with the link" (Viewer). It does NOT
   need "Publish to web". And the page must be opened from a web address
   (http://localhost:… or your hosted site), not by double-clicking the file:
   Google refuses to answer a page opened that way.
   ========================================================================= */

/** Has the owner filled in their Sheet ID yet? */
function isSheetConfigured() {
  return typeof SHEET_ID === "string" &&
         SHEET_ID.trim() !== "" &&
         !SHEET_ID.startsWith("PASTE_");
}

/** True when the admin opened the page with ?preview=true. */
function isPreviewRequested() {
  return new URLSearchParams(window.location.search).get("preview") === "true";
}

/** A sheet cell as trimmed text. Blank cells come back as "". */
function cellText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Downloads the sheet and returns one plain object per row, keyed by the
 * column headings (lower-cased), e.g. { date: "2026-11-09", q1_text: "…" }.
 */
async function fetchSheetRows() {
  // A page opened by double-clicking the file has no web address at all
  // (its address bar shows file://…), and browsers refuse to let a page
  // like that fetch anything from docs.google.com. Catching this up front
  // gives a precise answer instead of a confusing network error — Safari
  // in particular reports this failure as the unhelpful "Load failed".
  if (location.protocol === "file:") {
    throw new Error(
      "this page was opened as a file (its address starts with file://), and browsers won't let a page " +
      "like that reach Google. Open it from a web address instead — run " +
      '"python3 -m http.server 8000" in this folder and visit http://localhost:8000, or use your hosted site.'
    );
  }

  const url = "https://docs.google.com/spreadsheets/d/" +
              encodeURIComponent(SHEET_ID.trim()) +
              "/gviz/tq?tqx=out:json&headers=1";

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    // A network-level failure (offline, blocked, DNS, etc.) — the browser's
    // own wording for this varies a lot ("Failed to fetch" in Chrome,
    // "Load failed" in Safari, "NetworkError…" in Firefox), so our message
    // explains what it usually means rather than repeating that wording.
    throw new Error("couldn't reach Google at all — check you're online, and that nothing " +
      "(an ad blocker, a work network) is blocking docs.google.com");
  }
  if (!response.ok) throw new Error("the sheet answered with HTTP " + response.status);
  return rowsFromGviz(await response.text());
}

/**
 * Google wraps its answer in a function call —
 *   google.visualization.Query.setResponse({...});
 * — so this cuts the JSON out and turns it into rows.
 */
function rowsFromGviz(text) {
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1) {
    throw new Error("that isn't a Sheets answer — is the sheet shared as \"Anyone with the link\"?");
  }

  const data = JSON.parse(text.slice(start + 1, end));
  if (data.status === "error") {
    const first = data.errors && data.errors[0];
    throw new Error("Sheets reported an error: " + (first ? first.detailed_message || first.message : "unknown"));
  }

  const headings = data.table.cols.map(function (col) {
    return String(col.label || "").trim().toLowerCase();
  });
  if (headings.indexOf("date") === -1 || headings.indexOf("status") === -1) {
    throw new Error('couldn\'t find the "date" and "status" headings in row 1');
  }

  return data.table.rows.map(function (row) {
    const obj = {};
    headings.forEach(function (heading, i) {
      const cell = row.c && row.c[i];
      if (heading && cell && cell.v !== null && cell.v !== undefined) {
        obj[heading] = cell.v;
      }
    });
    return obj;
  });
}

/**
 * Turns a date cell into "YYYY-MM-DD".
 * A plain-text cell already is one. A cell that Sheets has turned into a
 * real date arrives as "Date(2026,10,9)" — and its month counts from 0.
 */
function normalizeSheetDate(raw) {
  const text = cellText(raw);
  const asDate = text.match(/^Date\((\d+),\s*(\d+),\s*(\d+)/);
  if (asDate) {
    const month = String(Number(asDate[2]) + 1).padStart(2, "0");
    const day = String(Number(asDate[3])).padStart(2, "0");
    return asDate[1] + "-" + month + "-" + day;
  }
  return text;
}

/** The row for a given day with a given status ("live" or "draft"), or undefined. */
function findRow(rows, day, status) {
  return rows.find(function (row) {
    return normalizeSheetDate(row.date) === day &&
           cellText(row.status).toLowerCase() === status;
  });
}

/**
 * For a multiple-choice question: which option (0-3) is the right one?
 * The answer cell can hold the option's letter ("A") or its text ("Mercury").
 * Returns -1 if it matches nothing.
 */
function findCorrectOption(options, answers) {
  if (answers.length === 1 && /^[a-d]$/i.test(answers[0])) {
    return answers[0].toLowerCase().charCodeAt(0) - 97;
  }
  const wanted = answers.map(function (a) { return a.toLowerCase(); });
  return options.findIndex(function (option) {
    return wanted.indexOf(option.toLowerCase()) !== -1;
  });
}

/**
 * Turns the image cell into something an <img> can load.
 *   - Google Drive "share" links aren't pictures, so they're rewritten to the
 *     direct form (the file must be shared as "anyone with the link").
 *   - https:// links and file paths like images/q1.png are used as they are.
 *   - Any other kind of link is ignored, with a note in the console.
 * A blank cell means "no picture". Never throws: a picture is a bonus, and a
 * typo in it shouldn't stop the quiz.
 */
function normalizeImageUrl(raw, n) {
  const link = cellText(raw);
  if (!link) return "";

  const drive = link.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ||
                link.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  if (drive) return "https://lh3.googleusercontent.com/d/" + drive[1];

  if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:/i.test(link)) {
    console.warn("QUIZ://01 — Q" + n + ': ignoring the image "' + link +
                 '" — it must start with https:// or be a file path like images/q1.png');
    return "";
  }
  return link;
}

/** Adds the picture to a question, if it has one. */
function withImage(question, image) {
  if (image) question.image = image;
  return question;
}

/** Appended to errors where a typed-in number may have been lost by Sheets. */
const PLAIN_TEXT_HINT = " (if you did type something, format that column as Plain text in Sheets)";

/**
 * Reads the points cell. One whole number ("10") for a normal question, or
 * one per answer part joined with + ("2+2") for a question with several
 * parts. Returns the numbers as an array.
 */
function parsePointsCell(raw, n) {
  const text = cellText(raw);
  if (!text) throw new Error("Q" + n + ": the points cell is empty" + PLAIN_TEXT_HINT);

  const values = text.split("+").map(function (v) { return v.trim(); });
  const allWholeAndPositive = values.every(function (v) {
    return /^\d+$/.test(v) && Number(v) > 0;
  });
  if (!allWholeAndPositive) {
    throw new Error("Q" + n + ': the points must be whole numbers above 0, joined with + when the ' +
                    'question has several parts (like 2+2) — not "' + text + '"');
  }
  return values.map(Number);
}

/**
 * Reads the answers cell of a typed question into parts. Parts are separated
 * by |, and within a part commas separate alternative spellings:
 *   "eiffel tower,eiffel | statue of liberty,liberty"  →  two parts
 */
function parseAnswerParts(raw, n) {
  const text = cellText(raw);
  if (!text) throw new Error("Q" + n + ": the answers cell is empty" + PLAIN_TEXT_HINT);

  const parts = text.split("|").map(function (part) {
    return part.split(",").map(function (a) { return a.trim(); }).filter(Boolean);
  });
  if (parts.some(function (alternatives) { return alternatives.length === 0; })) {
    throw new Error("Q" + n + ": one of the answer parts (separated by |) is empty");
  }
  if (parts.length > MAX_PARTS) {
    throw new Error("Q" + n + ": a question can have at most " + MAX_PARTS + " answer parts");
  }
  return parts;
}

/** "1 answer part" / "2 answer parts", for the error messages. */
function countWords(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s");
}

/**
 * Builds question number n (1, 2 or 3) from a sheet row, in the same shape
 * as FALLBACK_QUESTIONS. Throws a plain-English error if it's filled in wrong.
 */
function buildQuestion(row, n) {
  const prefix = "q" + n + "_";
  const text = cellText(row[prefix + "text"]);
  const type = cellText(row[prefix + "type"]).toLowerCase();

  if (!text) throw new Error("Q" + n + ": the question text is empty");
  if (type !== "text" && type !== "mcq") throw new Error('Q' + n + ': the type must be "text" or "mcq"');

  const pointValues = parsePointsCell(row[prefix + "points"], n);
  const image = normalizeImageUrl(row[prefix + "image"], n);

  if (type === "text") {
    const answerParts = parseAnswerParts(row[prefix + "answers"], n);

    // Every answer part needs its own points, and every points value needs a part
    if (answerParts.length !== pointValues.length) {
      throw new Error("Q" + n + ": the answers cell has " + countWords(answerParts.length, "part") +
                      " (separated by |) but the points cell has " + countWords(pointValues.length, "value") +
                      " (separated by +)");
    }

    const parts = answerParts.map(function (answers, i) {
      return { answers: answers, points: pointValues[i] };
    });
    const total = pointValues.reduce(function (sum, v) { return sum + v; }, 0);
    return withImage({ text: text, type: "text", parts: parts, points: total }, image);
  }

  // Multiple choice: one right option, one points value
  if (pointValues.length > 1) {
    throw new Error("Q" + n + ": a multiple-choice question takes one points value, not several joined with +");
  }
  const answers = cellText(row[prefix + "answers"]).split(",")
    .map(function (a) { return a.trim(); })
    .filter(Boolean);
  if (answers.length === 0) throw new Error("Q" + n + ": the answers cell is empty" + PLAIN_TEXT_HINT);

  const options = ["a", "b", "c", "d"].map(function (letter) {
    return cellText(row[prefix + "opt_" + letter]);
  });
  if (options.some(function (o) { return !o; })) {
    throw new Error("Q" + n + ": a multiple-choice question needs all four options (A–D)" + PLAIN_TEXT_HINT);
  }
  const correct = findCorrectOption(options, answers);
  if (correct === -1) {
    throw new Error("Q" + n + ": the answer doesn't match any of the four options");
  }
  return withImage({ text: text, type: "mcq", options: options, correct: correct, points: pointValues[0] }, image);
}

/** All three questions from one row. */
function buildQuestionsFromRow(row) {
  return [1, 2, 3].map(function (n) { return buildQuestion(row, n); });
}

/**
 * Works out today's questions and records where they came from in
 * state.quizMode. Never throws — see the table at the top of this section.
 */
async function loadTodaysQuestions() {
  if (!isSheetConfigured()) {
    state.questions = FALLBACK_QUESTIONS;
    state.quizMode = "fallback";
    return;
  }

  // 1. Reach the sheet. If that fails, play the sample quiz rather than nothing.
  let rows;
  try {
    rows = await withTimeout(fetchSheetRows(), 6, "fetching the questions");
  } catch (err) {
    console.warn("QUIZ://01 — couldn't read the Google Sheet, using the sample questions.", err);
    state.questions = FALLBACK_QUESTIONS;
    state.quizMode = "fallback";
    return;
  }

  // 2. Find today's row: live first, or a draft if the admin is previewing.
  const today = todayKey();
  let row = findRow(rows, today, "live");
  let mode = "live";
  if (!row && isPreviewRequested()) {
    row = findRow(rows, today, "draft");
    mode = "preview";
  }
  if (!row) {
    state.questions = [];
    state.quizMode = "none";
    return;
  }

  // 3. Check it. A broken row means no quiz, not the wrong quiz.
  try {
    state.questions = buildQuestionsFromRow(row);
    state.quizMode = mode;
  } catch (err) {
    console.error("QUIZ://01 — today's row in the Google Sheet is filled in wrong: " + err.message);
    state.questions = [];
    state.quizMode = "none";
  }
}


/* =========================================================================
   DATES
   ========================================================================= */

/**
 * Today as "YYYY-MM-DD" — used for the storage keys and, later, for
 * looking up today's row in the Google Sheet.
 * Built from the local date, so it rolls over at the player's midnight.
 */
function todayKey() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day   = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Today as "MON 09 NOV 2026" — the version players see. */
function todayLabel() {
  const days   = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  return `${days[d.getDay()]} ${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}


/* =========================================================================
   STORAGE
   Wrapped in try/catch because private browsing can block localStorage,
   and a blocked save should never crash the quiz.
   ========================================================================= */

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    /* ignore — the game still works, it just won't remember */
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* ignore */
  }
}

/** True if this browser has already finished today's quiz. */
function hasPlayedToday() {
  return storageGet(KEY_PLAYED + todayKey()) === "true";
}

/**
 * Today's saved score, e.g. { points: 25, time_display: "1m 42s" }.
 * Returns null if there isn't one (or if it can't be read).
 */
function savedScoreToday() {
  const raw = storageGet(KEY_SCORE + todayKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Marks today as played and stores the score.
 * Called from the results screen in STEP 4 — defined here so the
 * replay-block rules all live in one place.
 */
function markPlayedToday(score) {
  storageSet(KEY_PLAYED + todayKey(), "true");
  storageSet(KEY_SCORE + todayKey(), JSON.stringify(score));
}

/** Clears today's play so the quiz can be taken again (used by ?reset). */
function clearTodaysPlay() {
  storageRemove(KEY_PLAYED + todayKey());
  storageRemove(KEY_SCORE + todayKey());
}


/* =========================================================================
   SOUND
   All sounds are generated by the browser — there are no audio files.
   ========================================================================= */

let audioCtx = null;

/**
 * The Web Audio "context" that makes the sounds.
 * Created on the first play, because browsers only allow audio to start
 * after the player has interacted with the page.
 */
function getAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;             // very old browser: no sound
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Plays one short note.
 *   freq     — pitch in hertz (e.g. 523 is C5)
 *   type     — "square" or "sawtooth" (the 8-bit sounding waveforms)
 *   startAt  — seconds from now
 *   duration — how long the note lasts, in seconds
 */
function playNote(freq, type, startAt, duration) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc  = ctx.createOscillator();   // makes the tone
  const gain = ctx.createGain();         // controls its volume

  osc.type = type;
  osc.frequency.value = freq;

  const t = ctx.currentTime + startAt;
  // Quick fade in and out, so notes don't click
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Rising 3-note chime for a correct answer. */
function playCorrectSound() {
  if (!state.soundOn) return;
  playNote(523, "square", 0,    0.13);   // C5
  playNote(659, "square", 0.13, 0.13);   // E5
  playNote(784, "square", 0.26, 0.14);   // G5
}

/** Falling 2-note buzz for a wrong answer. */
function playWrongSound() {
  if (!state.soundOn) return;
  playNote(220, "sawtooth", 0,   0.18);  // A3
  playNote(175, "sawtooth", 0.2, 0.2);   // F3
}

/** Two level-ish notes for a partly right answer: pleased, but not a fanfare. */
function playPartialSound() {
  if (!state.soundOn) return;
  playNote(523, "square", 0,    0.12);   // C5
  playNote(587, "square", 0.13, 0.18);   // D5
}

/** Tiny blip for button presses. */
function playClickSound() {
  if (!state.soundOn) return;
  playNote(262, "square", 0, 0.08);      // C4
}

/** Five-note victory melody for the results screen. */
function playFanfareSound() {
  if (!state.soundOn) return;
  playNote(523, "square", 0,    0.16);   // C5
  playNote(659, "square", 0.16, 0.16);   // E5
  playNote(784, "square", 0.32, 0.16);   // G5
  playNote(1047, "square", 0.48, 0.2);   // C6
  playNote(784, "square", 0.72, 0.4);    // G5
}

/** Quick upward sweep used when screens change. */
function playTransitionSound() {
  if (!state.soundOn) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime;

  osc.type = "square";
  osc.frequency.setValueAtTime(330, t);
  osc.frequency.linearRampToValueAtTime(880, t + 0.1);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

/** Reads the saved on/off choice (sound is on the first time). */
function loadSoundPreference() {
  state.soundOn = storageGet(KEY_SOUND) !== "false";
  updateSoundButton();
}

/** Flips sound on/off, saves the choice and updates the button. */
function toggleSound() {
  state.soundOn = !state.soundOn;
  storageSet(KEY_SOUND, String(state.soundOn));
  updateSoundButton();
  playClickSound();                       // silent when turning off
}

/** Keeps the 🔊/🔇 button in step with the setting. */
function updateSoundButton() {
  const btn = document.getElementById("sound-toggle");
  if (!btn) return;
  btn.textContent = state.soundOn ? "🔊" : "🔇";
  btn.setAttribute("aria-pressed", String(state.soundOn));
  btn.setAttribute("aria-label", state.soundOn ? "Turn sound off" : "Turn sound on");
}


/* =========================================================================
   SCREENS
   Every screen is a <section class="screen">. Showing one is just a
   matter of moving the "is-active" class.
   ========================================================================= */

/**
 * Switches to a screen, with a quick white flash over the glass.
 *   id — e.g. "screen-onboarding"
 */
function showScreen(id) {
  const next = document.getElementById(id);
  if (!next) return;

  flashScreen();
  playTransitionSound();

  document.querySelectorAll(".screen").forEach(function (section) {
    section.classList.toggle("is-active", section === next);
  });

  // Start each screen at the top, in case the last one was scrolled
  const panel = document.getElementById("panel-game");
  if (panel) panel.scrollTop = 0;
}

/** The 150ms white flash that covers the glass between screens. */
function flashScreen() {
  const flash = document.getElementById("crt-flash");
  if (!flash) return;
  flash.classList.remove("is-active");
  void flash.offsetWidth;          // forces the animation to restart
  flash.classList.add("is-active");
}


/**
 * Starts downloading today's pictures in the background, so they're ready
 * the moment the quiz begins. The clock starts at question 1, so a slow
 * picture must never be allowed to eat into a player's time.
 * Returns nothing when today has no pictures.
 */
function startImagePreload() {
  const urls = state.questions.map(function (q) { return q.image; }).filter(Boolean);
  if (urls.length === 0) return;

  state.preloaded = [];
  const downloads = urls.map(function (url) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = img.onerror = resolve;      // a broken one is handled when shown
      img.src = url;
      state.preloaded.push(img);
    });
  });

  // Never hold a player up for more than 8 seconds
  const pending = withTimeout(Promise.all(downloads), 8, "loading the pictures")
    .catch(function (err) { console.warn("QUIZ://01 — " + err.message + ", starting anyway."); })
    .then(function () { state.imagesPending = null; });
  state.imagesPending = pending;
}

/**
 * If the pictures are still arriving when the player presses start, wait
 * for them (the button says so). Usually they're long done by then.
 */
async function waitForImages() {
  if (!state.imagesPending) return;

  const btn = document.getElementById("btn-start");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "LOADING PICTURES…";
  try {
    await state.imagesPending;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}


/* =========================================================================
   FIREBASE
   -------------------------------------------------------------------------
   Everything here is optional. If firebase-config.js still has the
   placeholder values — or the connection fails — the game carries on with
   the sample players, so a broken database never stops anyone playing.

   What gets stored:
     /daily/{YYYY-MM-DD}/scores/{name}  one document per player per day
     /alltime/{name}                    running totals across all days
   ========================================================================= */

const firebase = {
  db: null,       // the database, once connected
  fns: null,      // the Firestore functions we use
  ready: false    // true only when it's actually usable
};

const SDK = "https://www.gstatic.com/firebasejs/10.12.0/";

/**
 * Gives up on a slow request instead of waiting forever.
 * Firestore retries a broken connection indefinitely, which would leave
 * the player staring at "…" where their rank should be.
 */
function withTimeout(promise, seconds, what) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error(what + " took too long"));
      }, seconds * 1000);
    })
  ]);
}

/**
 * Retries a Firestore operation once if it fails.
 * -------------------------------------------------------------------------
 * The very first request on a freshly created Firestore connection can
 * occasionally come back "permission-denied" even though the security
 * rules are fine — a known quirk while the connection is still warming
 * up. The exact same request always succeeds moments later, so rather
 * than chase that race, we just try again before giving up. This also
 * covers a genuinely flaky connection, which is worth doing regardless.
 */
async function withRetry(operation, options) {
  const attempts = (options && options.attempts) || 2;
  const delayMs = (options && options.delayMs) || 500;
  const timeoutSeconds = options && options.timeoutSeconds;
  const label = options && options.label;

  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(operation(), timeoutSeconds, label);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
      }
    }
  }
  throw lastError;
}

/** Has the owner filled in their Firebase details yet? */
function isFirebaseConfigured() {
  return typeof FIREBASE_CONFIG === "object" &&
         FIREBASE_CONFIG.apiKey &&
         !FIREBASE_CONFIG.apiKey.startsWith("PASTE_") &&
         FIREBASE_CONFIG.projectId &&
         !FIREBASE_CONFIG.projectId.startsWith("your-");
}

/**
 * Connects to Firebase. The SDK is only downloaded if there are real
 * settings to use, so an unconfigured game loads nothing extra.
 */
async function connectFirebase() {
  if (!isFirebaseConfigured()) {
    console.info("QUIZ://01 — no Firebase settings yet, using sample players.");
    return;
  }

  try {
    const [app, store] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-firestore.js")
    ]);

    firebase.db = store.getFirestore(app.initializeApp(FIREBASE_CONFIG));
    firebase.fns = store;
    firebase.ready = true;
  } catch (err) {
    console.warn("QUIZ://01 — couldn't reach Firebase, using sample players.", err);
  }
}

/**
 * Turns a player's name into something usable as a document name.
 * Firestore ids can't contain "/" and can't be empty.
 */
function docKey(name) {
  return name.trim().replace(/[/\\.#$\[\]]/g, "-").slice(0, 60) || "player";
}

/** The player's IP, if the owner asked for it. Null otherwise. */
async function lookUpIp() {
  if (typeof STORE_IP === "undefined" || !STORE_IP) return null;
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip || null;
  } catch (err) {
    return null;         // never let this hold up saving the score
  }
}

/**
 * Saves a finished run: one document for today, plus the player's
 * running all-time totals.
 */
async function saveScoreToFirebase(entry) {
  const { doc, setDoc, getDoc, serverTimestamp } = firebase.fns;
  const key = docKey(entry.name);

  const record = {
    name: entry.name,
    points: entry.points,
    time_seconds: entry.time_seconds,
    time_display: entry.time_display,
    submitted_at: serverTimestamp()
  };

  const ip = await lookUpIp();
  if (ip) record.ip = ip;

  // Today's score
  await setDoc(doc(firebase.db, "daily", todayKey(), "scores", key), record);

  // All-time totals: add to what's already there, or start fresh
  const allTimeRef = doc(firebase.db, "alltime", key);
  const existing = await getDoc(allTimeRef);

  if (existing.exists()) {
    const previous = existing.data();
    await setDoc(allTimeRef, {
      name: entry.name,
      total_points: (previous.total_points || 0) + entry.points,
      days_played: (previous.days_played || 0) + 1,
      last_played: serverTimestamp()
    });
  } else {
    await setDoc(allTimeRef, {
      name: entry.name,
      total_points: entry.points,
      days_played: 1,
      last_played: serverTimestamp()
    });
  }
}

/** Everyone who has played today, straight from the database. */
async function readTodayScores() {
  const { collection, getDocs } = firebase.fns;
  const snapshot = await getDocs(collection(firebase.db, "daily", todayKey(), "scores"));
  return snapshot.docs.map(function (d) {
    return d.data();
  });
}

/** The all-time totals for everyone. */
async function readAllTime() {
  const { collection, getDocs } = firebase.fns;
  const snapshot = await getDocs(collection(firebase.db, "alltime"));
  return snapshot.docs.map(function (d) {
    return d.data();
  });
}


/* =========================================================================
   THE CLOCK
   One clock for the whole quiz: it starts when question 1 appears and
   stops when the last answer is submitted. There is no per-question limit.
   ========================================================================= */

/** Seconds since question 1 appeared. */
function secondsSoFar() {
  if (!state.startedAt) return 0;
  return Math.floor((Date.now() - state.startedAt) / 1000);
}

/** 95 seconds → "01:35" (for the clock in the top bar). */
function formatClock(totalSeconds) {
  const mins = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const secs = String(totalSeconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

/** 95 seconds → "1m 35s" (for the results screen and the saved score). */
function formatDuration(totalSeconds) {
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function startClock() {
  state.startedAt = Date.now();
  updateClock();
  state.tickTimer = setInterval(updateClock, 1000);
}

function stopClock() {
  clearInterval(state.tickTimer);
  state.tickTimer = null;
  state.elapsed = secondsSoFar();
}

function updateClock() {
  const el = document.getElementById("q-timer");
  if (el) el.textContent = formatClock(secondsSoFar());
}


/* =========================================================================
   THE QUIZ
   ========================================================================= */

/** Sets up a fresh run and shows question 1. */
async function startQuiz() {
  // The questions were loaded at start-up (sheet, draft preview or samples)
  if (state.questions.length === 0 || state.starting) return;
  state.starting = true;

  try {
    // The clock must not start until any pictures are ready
    await waitForImages();

    state.current = 0;
    state.points = 0;
    state.elapsed = 0;

    // Dims the decorative corner icons while a quiz is in progress
    document.getElementById("crt").classList.add("is-playing");

    startClock();
    showQuestion();
    showScreen("screen-question");
    focusAnswerBox();
  } finally {
    state.starting = false;
  }
}

/** Draws the current question, in whichever style it needs. */
function showQuestion() {
  const q = state.questions[state.current];
  const total = state.questions.length;

  // Top bar
  document.getElementById("q-counter").textContent =
    `Q.${String(state.current + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;

  // Progress dots: filled for questions already answered
  const dots = document.getElementById("q-dots");
  dots.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement(i < state.current ? "b" : "span");
    dot.textContent = i < state.current ? "●" : "○";
    dots.appendChild(dot);
  }

  const textEl = document.getElementById("q-text");
  textEl.textContent = q.text;
  // Long questions get smaller type so they never push the answers off screen
  textEl.classList.toggle("question--long", q.text.length > 60);
  textEl.classList.toggle("question--xlong", q.text.length > 200);   // paragraph-length: smaller still, on wide screens
  showQuestionImage(q);
  showPartsHint(q);

  const textBox = document.getElementById("q-type-text");
  const mcqBox  = document.getElementById("q-type-mcq");

  if (q.type === "mcq") {
    textBox.hidden = true;
    mcqBox.hidden = false;
    buildOptions(q);
  } else {
    mcqBox.hidden = true;
    textBox.hidden = false;
    document.getElementById("answer-error").textContent = "";
    buildAnswerInputs(partsOf(q).length);
  }
}

/**
 * Puts the cursor in the first answer box of a typed question, so a player
 * on a computer can just start typing. Skipped on touch screens, where it
 * would pop the keyboard up over the question. Must run AFTER the question
 * screen is showing — a hidden box can't take focus.
 */
function focusAnswerBox() {
  const first = document.getElementById("answer-input");
  const typed = !document.getElementById("q-type-text").hidden;
  if (first && typed && window.matchMedia("(pointer: fine)").matches) first.focus();
}

/**
 * For a question with several answer parts, a small line telling the player
 * how many answers it wants and what each is worth, e.g. "2 ANSWERS · 2 + 2 PTS".
 * Hidden for ordinary one-answer questions.
 */
function showPartsHint(question) {
  const hint = document.getElementById("q-hint");
  const parts = question.type === "text" ? partsOf(question) : [];
  if (parts.length < 2) {
    hint.hidden = true;
    return;
  }
  hint.textContent = parts.length + " ANSWERS · " +
    parts.map(function (p) { return p.points; }).join(" + ") + " PTS";
  hint.hidden = false;
}

/**
 * Builds one text box per answer part and returns the first. Enter moves to
 * the next box, and submits from the last one. (The first box keeps the id
 * "answer-input".)
 */
function buildAnswerInputs(count) {
  const box = document.getElementById("answer-inputs");
  box.innerHTML = "";
  box.classList.toggle("answer-inputs--multi", count > 1);

  for (let i = 0; i < count; i++) {
    const input = document.createElement("input");
    input.className = "input";
    input.type = "text";
    input.maxLength = 40;
    input.autocomplete = "off";
    input.placeholder = count === 1 ? "TYPE YOUR ANSWER" : "ANSWER " + (i + 1);
    input.setAttribute("aria-label", count === 1 ? "Your answer" : "Answer " + (i + 1) + " of " + count);
    if (i === 0) input.id = "answer-input";

    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      const next = box.children[i + 1];
      if (next) next.focus();
      else submitTypedAnswer();
    });
    input.addEventListener("input", function () {
      document.getElementById("answer-error").textContent = "";
    });
    box.appendChild(input);
  }
  return box.children[0];
}

/**
 * Shows the question's picture above the answer area, or hides the frame
 * if there isn't one. If the picture won't load, a small note takes its
 * place and the question can still be answered.
 */
function showQuestionImage(question) {
  const frame = document.getElementById("q-image");
  const img   = document.getElementById("q-image-img");
  const note  = document.getElementById("q-image-fail");

  if (!question.image) {
    frame.hidden = true;
    img.removeAttribute("src");
    return;
  }

  img.hidden = false;
  note.hidden = true;
  img.onload  = function () { img.hidden = false; note.hidden = true; };
  img.onerror = function () { img.hidden = true;  note.hidden = false; };
  frame.hidden = false;
  img.src = question.image;
}

/** Builds the four A/B/C/D buttons for a multiple-choice question. */
function buildOptions(question) {
  const box = document.getElementById("q-type-mcq");
  const letters = ["A", "B", "C", "D"];
  box.innerHTML = "";

  question.options.forEach(function (optionText, index) {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML =
      `<span class="option__letter">${letters[index]}</span>` +
      `<span class="option__text"></span>`;
    btn.querySelector(".option__text").textContent = optionText;

    // Tapping an option answers straight away — no separate submit
    btn.addEventListener("click", function () {
      playClickSound();
      disableOptions();
      btn.classList.add("is-chosen");     // the picked one stays bright
      const right = index === question.correct;
      finishQuestion(right ? "right" : "wrong", right ? question.points : 0, []);
    });

    box.appendChild(btn);
  });
}

/** Stops further taps once an option has been chosen. */
function disableOptions() {
  document.querySelectorAll("#q-type-mcq .option").forEach(function (btn) {
    btn.disabled = true;
  });
}

/** Trims, lower-cases and tidies spacing, so "  Paris " matches "paris". */
function normalizeAnswer(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Does a typed value match any accepted spelling of this answer part? */
function partAccepts(part, typed) {
  return part.answers.some(function (accepted) {
    return normalizeAnswer(accepted) === typed;
  });
}

/**
 * Works out which answer parts the player got right.
 *   - Order doesn't matter: the right answer in the "wrong" box still counts.
 *   - A part can be won only once, so typing the same answer twice can't
 *     score two parts.
 *   - It pairs typed answers with parts the best way it can, so a part that
 *     happens to accept the same word as another can't cause a lost point.
 * Returns an array of true/false, one per part.
 */
function matchParts(parts, typedValues) {
  const typedForPart = new Array(parts.length).fill(-1);

  function assign(t, tried) {
    for (let p = 0; p < parts.length; p++) {
      if (tried[p] || !partAccepts(parts[p], typedValues[t])) continue;
      tried[p] = true;
      if (typedForPart[p] === -1 || assign(typedForPart[p], tried)) {
        typedForPart[p] = t;
        return true;
      }
    }
    return false;
  }

  typedValues.forEach(function (_, t) {
    assign(t, new Array(parts.length).fill(false));
  });
  return typedForPart.map(function (t) { return t !== -1; });
}

/** Runs when "SUBMIT" is pressed on a typed question. */
function submitTypedAnswer() {
  const q = state.questions[state.current];
  const parts = partsOf(q);
  const inputs = Array.prototype.slice.call(document.querySelectorAll("#answer-inputs input"));

  // Empty boxes are fine (answering only one part is allowed) — all empty isn't
  const typed = inputs.map(function (input) { return normalizeAnswer(input.value); })
                      .filter(Boolean);
  if (typed.length === 0) {
    document.getElementById("answer-error").textContent =
      parts.length > 1 ? "FILL IN AT LEAST ONE ANSWER" : "TYPE AN ANSWER FIRST";
    inputs[0].focus();
    return;
  }

  playClickSound();

  const won = matchParts(parts, typed);
  const earned = parts.reduce(function (sum, part, i) { return sum + (won[i] ? part.points : 0); }, 0);
  const missed = parts.filter(function (part, i) { return !won[i]; });
  const outcome = missed.length === 0 ? "right" : (earned > 0 ? "partial" : "wrong");

  finishQuestion(outcome, earned, missed);
}

/**
 * Records the points and shows the matching screen.
 *   outcome — "right" (all of it), "partial" (some parts) or "wrong"
 *   earned  — points won
 *   missed  — the answer parts the player didn't get
 */
function finishQuestion(outcome, earned, missed) {
  const q = state.questions[state.current];
  const isLastQuestion = state.current === state.questions.length - 1;

  // The clock runs until the final answer is in
  if (isLastQuestion) stopClock();

  state.points += earned;

  if (outcome === "right") {
    showCorrectScreen(earned, isLastQuestion);
  } else if (outcome === "partial") {
    showPartialScreen(earned, q, missed, isLastQuestion);
  } else {
    showWrongScreen(q, isLastQuestion);
  }
}

/** The answer parts as one line, e.g. "EIFFEL TOWER + STATUE OF LIBERTY". */
function describeParts(parts) {
  return parts.map(function (part) { return part.answers[0]; }).join("  +  ");
}

/** The green "CORRECT" screen. */
function showCorrectScreen(pointsWon, isLastQuestion) {
  setTotal("correct-total", state.points);
  document.getElementById("btn-next-correct").textContent =
    isLastQuestion ? "▶ SEE RESULTS" : "▶ NEXT QUESTION →";

  showScreen("screen-correct");
  greenFlash();
  playCorrectSound();
  countUpPoints(document.getElementById("correct-points"), pointsWon);
}

/** The "PARTLY RIGHT" screen: points for what they got, and what they missed. */
function showPartialScreen(pointsWon, question, missedParts, isLastQuestion) {
  const total = partsOf(question).length;
  document.getElementById("partial-count").textContent = (total - missedParts.length) + " OF " + total;
  document.getElementById("partial-missed").textContent = describeParts(missedParts);

  setTotal("partial-total", state.points);
  document.getElementById("btn-next-partial").textContent =
    isLastQuestion ? "▶ SEE RESULTS" : "▶ NEXT QUESTION →";

  showScreen("screen-partial");
  playPartialSound();
  countUpPoints(document.getElementById("partial-points"), pointsWon);
}

/** The pink "WRONG" screen, with the answer revealed. */
function showWrongScreen(question, isLastQuestion) {
  const answerEl = document.getElementById("wrong-answer");
  answerEl.textContent = question.type === "mcq"
    ? question.options[question.correct]
    : describeParts(partsOf(question));

  setTotal("wrong-total", state.points);
  document.getElementById("btn-next-wrong").textContent =
    isLastQuestion ? "▶ SEE RESULTS" : "▶ NEXT QUESTION →";

  showScreen("screen-wrong");
  shakeScreen("screen-wrong");
  playWrongSound();
}

/** Moves on to the next question, or to the results. */
function advance() {
  playClickSound();

  if (state.current < state.questions.length - 1) {
    state.current += 1;
    showQuestion();
    showScreen("screen-question");
    focusAnswerBox();
  } else {
    showResults();
  }
}

/**
 * The end of a run: saves the score, works out today's rank and
 * fills in the results screen.
 */
async function showResults() {
  const timeDisplay = formatDuration(state.elapsed);

  // The player's own line on today's leaderboard
  state.myEntry = {
    name: state.playerName,
    points: state.points,
    time_seconds: state.elapsed,
    time_display: timeDisplay
  };

  // A draft preview is a rehearsal: nothing is saved and the admin can
  // run it again. A real run counts, and locks this browser for today.
  const isPreview = state.quizMode === "preview";
  if (!isPreview) {
    markPlayedToday({ points: state.points, time_display: timeDisplay });
  }

  document.getElementById("result-score").textContent = state.points;
  document.getElementById("result-max").textContent = maxPossiblePoints();
  document.getElementById("result-time").textContent = timeDisplay.toUpperCase();
  document.getElementById("result-rank").textContent = "…";   // until it's known

  showScreen("screen-results");
  playFanfareSound();

  if (isPreview) {
    document.getElementById("result-rank").textContent = "—";
    return;
  }

  // Saving and ranking happen after the screen is up, so a slow
  // connection never leaves the player staring at a blank screen.
  let saved = false;
  if (firebase.ready) {
    try {
      await withRetry(function () { return saveScoreToFirebase(state.myEntry); },
        { timeoutSeconds: 6, label: "saving the score" });
      saved = true;
    } catch (err) {
      console.warn("QUIZ://01 — score couldn't be saved.", err);
    }
  }
  if (!saved) {
    saveTodayEntry(state.myEntry);     // sample list, when there's no database
  }

  const rows = await loadTodayRows();
  document.getElementById("result-rank").textContent = rankIn(rows, state.myEntry);
}


/* =========================================================================
   LEADERBOARD
   ========================================================================= */

/**
 * Everyone who has played today, best first.
 * Comes from Firebase when it's connected, and from the sample list
 * when it isn't.
 */
async function loadTodayRows() {
  if (firebase.ready) {
    try {
      const rows = await withRetry(readTodayScores, { timeoutSeconds: 6, label: "reading today's scores" });
      return sortToday(rows);
    } catch (err) {
      console.warn("QUIZ://01 — couldn't read today's scores.", err);
    }
  }
  return sortToday(MOCK_TODAY.slice());
}

/** The all-time table, best first. */
async function loadAllTimeRows() {
  if (firebase.ready) {
    try {
      const rows = await withRetry(readAllTime, { timeoutSeconds: 6, label: "reading the all-time table" });
      return rows.sort(function (a, b) {
        return (b.total_points || 0) - (a.total_points || 0);
      });
    } catch (err) {
      console.warn("QUIZ://01 — couldn't read the all-time table.", err);
    }
  }
  return MOCK_ALLTIME.slice().sort(function (a, b) {
    return b.total_points - a.total_points;
  });
}

/** Most points wins; if two are level, the quicker time wins. */
function sortToday(entries) {
  return entries.sort(function (a, b) {
    if (b.points !== a.points) return b.points - a.points;
    return a.time_seconds - b.time_seconds;
  });
}

/** Adds a finished run to the sample list (only used without Firebase). */
function saveTodayEntry(entry) {
  const existing = MOCK_TODAY.findIndex(function (row) {
    return row.name.toLowerCase() === entry.name.toLowerCase();
  });
  if (existing !== -1) {
    MOCK_TODAY[existing] = entry;      // keep one row per player
  } else {
    MOCK_TODAY.push(entry);
  }
}

/** What position a run came in today — 1 is first. */
function rankIn(rows, entry) {
  const position = rows.findIndex(function (row) {
    return row.name.toLowerCase() === entry.name.toLowerCase();
  });
  return position === -1 ? "—" : position + 1;
}

/** 1, 2, 3 get medals; everyone else gets their number. */
function rankBadge(position) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return String(position);
}

/** True if a leaderboard row belongs to the player who just finished. */
function isMyRow(row) {
  return Boolean(state.myEntry) &&
         row.name.toLowerCase() === state.myEntry.name.toLowerCase();
}

/** Draws whichever leaderboard tab is open. */
async function renderLeaderboard() {
  const head  = document.getElementById("board-head");
  const body  = document.getElementById("board-body");
  const empty = document.getElementById("board-empty");
  const isToday = state.boardTab === "today";

  // Reading may take a moment over the network
  empty.hidden = false;
  empty.textContent = "LOADING…";

  const rows = isToday ? await loadTodayRows() : await loadAllTimeRows();

  // The player may have switched tabs while this was loading
  if ((state.boardTab === "today") !== isToday) return;

  head.innerHTML = isToday
    ? "<tr><th>#</th><th>NAME</th><th>PTS</th><th>TIME</th></tr>"
    : "<tr><th>#</th><th>NAME</th><th>TOTAL</th><th>DAYS</th></tr>";

  body.innerHTML = "";
  rows.forEach(function (row, index) {
    const tr = document.createElement("tr");
    if (isMyRow(row)) tr.className = "is-me";

    const rank = document.createElement("td");
    rank.className = "rank";
    rank.textContent = rankBadge(index + 1);

    const name = document.createElement("td");
    name.textContent = row.name;

    const main = document.createElement("td");
    main.textContent = isToday ? row.points : row.total_points;

    const extra = document.createElement("td");
    extra.textContent = isToday ? row.time_display : row.days_played;

    tr.append(rank, name, main, extra);
    body.appendChild(tr);
  });

  const nothingToShow = rows.length === 0;
  empty.textContent = isToday
    ? "NOBODY HAS PLAYED YET TODAY"
    : "NO SCORES RECORDED YET";
  empty.hidden = !nothingToShow;
  document.getElementById("board-table").hidden = nothingToShow;
}

/** Switches between the TODAY and ALL TIME tabs. */
function selectTab(which) {
  state.boardTab = which;

  const todayBtn = document.getElementById("tab-today");
  const allBtn   = document.getElementById("tab-alltime");
  todayBtn.classList.toggle("is-selected", which === "today");
  allBtn.classList.toggle("is-selected", which === "alltime");
  todayBtn.setAttribute("aria-selected", String(which === "today"));
  allBtn.setAttribute("aria-selected", String(which === "alltime"));

  renderLeaderboard();
}

/** Opens the leaderboard screen, always starting on TODAY. */
function openLeaderboard() {
  playClickSound();
  selectTab("today");
  showScreen("screen-leaderboard");
}

/**
 * Fills the top-3 box on the onboarding screen.
 * Takes rows that have already been loaded, so the box and the
 * "players today" count can never disagree.
 */
function renderTopThree(allRows) {
  const list = document.getElementById("top3-list");
  if (!list) return;

  const rows = allRows.slice(0, 3);
  list.innerHTML = "";

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "top3__empty";
    li.textContent = "NOBODY HAS PLAYED YET TODAY";
    list.appendChild(li);
    return;
  }

  rows.forEach(function (row, index) {
    const li = document.createElement("li");
    li.className = "top3__row";
    li.innerHTML =
      `<span>${rankBadge(index + 1)}</span>` +
      `<span class="top3__name"></span>` +
      `<span class="top3__pts">${row.points} PTS</span>`;
    li.querySelector(".top3__name").textContent = row.name;
    list.appendChild(li);
  });
}


/* =========================================================================
   SMALL VISUAL EFFECTS
   ========================================================================= */

/** Updates a running total and gives the number a small kick. */
function setTotal(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = value;
  el.classList.remove("is-popped");
  void el.offsetWidth;                  // restarts the animation
  el.classList.add("is-popped");
}

/** Counts a number up from zero, e.g. 0 → 15 over 600ms. */
function countUpPoints(element, target) {
  if (!element) return;
  const duration = 600;
  const startedAt = performance.now();

  function frame(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const value = Math.round(target * progress);
    element.textContent = `+${value} PTS`;
    if (progress < 1) requestAnimationFrame(frame);
  }

  element.textContent = "+0 PTS";
  requestAnimationFrame(frame);
}

/** A green wash over the glass, used when an answer is right. */
function greenFlash() {
  const flash = document.getElementById("crt-flash");
  if (!flash) return;
  flash.classList.add("crt__flash--green");
  flash.classList.remove("is-active");
  void flash.offsetWidth;
  flash.classList.add("is-active");
  // Back to a white flash for ordinary screen changes
  setTimeout(function () {
    flash.classList.remove("crt__flash--green");
  }, 400);
}

/** Shakes a screen briefly, used for a wrong answer. */
function shakeScreen(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.classList.remove("is-shaking");
  void section.offsetWidth;
  section.classList.add("is-shaking");
  setTimeout(function () {
    section.classList.remove("is-shaking");
  }, 320);
}


/* =========================================================================
   ONBOARDING
   ========================================================================= */

/**
 * Checks the typed name.
 * Returns the cleaned-up name, or null if it isn't usable (and shows why).
 */
function validateName(raw) {
  const name = raw.trim().replace(/\s+/g, " ");   // tidy up spacing
  const errorEl = document.getElementById("name-error");

  let problem = "";
  if (name.length === 0) {
    problem = "PLEASE ENTER A NAME";
  } else if (name.length < NAME_MIN) {
    problem = `AT LEAST ${NAME_MIN} CHARACTERS`;
  } else if (name.length > NAME_MAX) {
    problem = `AT MOST ${NAME_MAX} CHARACTERS`;
  }

  if (errorEl) errorEl.textContent = problem;
  return problem ? null : name;
}

/** Runs when "READY TO EMBARK" is pressed. */
function handleStart() {
  playClickSound();

  const input = document.getElementById("name-input");
  const name  = validateName(input ? input.value : "");
  if (!name) {
    if (input) input.focus();
    return;
  }

  state.playerName = name;
  startQuiz();
}

/** Fills in the "already played" screen from the saved score. */
function fillPlayedScreen() {
  const dateEl  = document.getElementById("played-date");
  const scoreEl = document.getElementById("played-score");
  if (dateEl) dateEl.textContent = todayLabel();

  const timeEl = document.getElementById("played-time");
  const saved  = savedScoreToday();

  if (scoreEl) {
    scoreEl.textContent = saved ? `${saved.points} PTS` : "SCORE SAVED";
  }
  if (timeEl) {
    timeEl.textContent = saved && saved.time_display
      ? `IN ${String(saved.time_display).toUpperCase()}`
      : "";
  }
}

/**
 * Which screen a player lands on: "no quiz today", "you've already
 * played", or the name form. A draft preview skips the played check, so
 * the admin can rehearse as often as they like.
 */
function openingScreenId() {
  if (state.quizMode === "none") return "screen-no-quiz";
  if (state.quizMode !== "preview" && hasPlayedToday()) return "screen-played";
  return "screen-onboarding";
}

/** Fills in whatever the chosen opening screen needs to show. */
function prepareOpeningScreen(id) {
  if (id === "screen-played") fillPlayedScreen();
  if (id === "screen-no-quiz") {
    document.getElementById("no-quiz-date").textContent = todayLabel();
  }
  // A small pink banner for the two situations where players aren't seeing
  // a normal live quiz. (The sample quiz is only worth flagging when a Sheet
  // IS set up — then it means the Sheet couldn't be read.)
  let note = "";
  if (state.quizMode === "preview") {
    note = "PREVIEW · SCORES NOT SAVED";
  } else if (state.quizMode === "fallback" && isSheetConfigured()) {
    note = "SAMPLE QUIZ · SHEET NOT REACHED";
  }
  const banner = document.getElementById("preview-banner");
  banner.textContent = note;
  banner.hidden = note === "";
  // lets the stylesheet keep content clear of the banner
  document.getElementById("crt").classList.toggle("has-banner", note !== "");
}

/**
 * The very first screen. It goes straight in, with no flash or sound,
 * because nothing has been clicked yet.
 */
function showOpeningScreen() {
  document.getElementById("crt").classList.remove("is-playing");
  refreshLiveNumbers();

  const id = openingScreenId();
  prepareOpeningScreen(id);
  document.querySelectorAll(".screen").forEach(function (section) {
    section.classList.toggle("is-active", section.id === id);
  });

  if (id === "screen-onboarding") {
    const input = document.getElementById("name-input");
    if (input) input.focus();
  }
}

/** The HOME buttons: back to the opening screen, with the usual flash. */
function goHome() {
  playClickSound();
  document.getElementById("crt").classList.remove("is-playing");
  refreshLiveNumbers();

  const id = openingScreenId();
  prepareOpeningScreen(id);
  showScreen(id);
}


/* =========================================================================
   START-UP
   ========================================================================= */

async function init() {
  // admin.html loads this same file so it can reuse the Sheet-reading and
  // Firebase functions below — but it has none of the game's screens, and
  // shouldn't try to start a quiz. admin.js does its own start-up instead.
  if (document.body.dataset.page !== "player") return;

  // ?reset=true wipes today's play, so the quiz can be tested again
  if (new URLSearchParams(window.location.search).get("reset") === "true") {
    clearTodaysPlay();
  }

  // Today's date under the title
  const dateEl = document.getElementById("today-date");
  if (dateEl) dateEl.textContent = todayLabel();

  loadSoundPreference();

  // --- Buttons ---
  document.getElementById("sound-toggle").addEventListener("click", toggleSound);
  document.getElementById("btn-start").addEventListener("click", handleStart);

  document.getElementById("btn-leaderboard").addEventListener("click", openLeaderboard);
  document.getElementById("btn-played-leaderboard").addEventListener("click", openLeaderboard);
  document.getElementById("btn-results-leaderboard").addEventListener("click", openLeaderboard);
  document.getElementById("btn-noquiz-leaderboard").addEventListener("click", openLeaderboard);

  document.getElementById("tab-today").addEventListener("click", function () {
    playClickSound();
    selectTab("today");
  });
  document.getElementById("tab-alltime").addEventListener("click", function () {
    playClickSound();
    selectTab("alltime");
  });

  // Any button marked data-home goes back to the opening screen
  document.querySelectorAll("[data-home]").forEach(function (btn) {
    btn.addEventListener("click", goHome);
  });

  // --- Quiz buttons ---
  document.getElementById("btn-submit").addEventListener("click", submitTypedAnswer);
  document.getElementById("btn-next-correct").addEventListener("click", advance);
  document.getElementById("btn-next-wrong").addEventListener("click", advance);
  document.getElementById("btn-next-partial").addEventListener("click", advance);

  // Enter in the name box is the same as pressing the green button
  const input = document.getElementById("name-input");
  if (input) {
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") handleStart();
    });
    // Clear the error message as soon as they start fixing it
    input.addEventListener("input", function () {
      document.getElementById("name-error").textContent = "";
    });
  }

  // The "LOADING…" screen is showing. Fetch today's questions and connect
  // to Firebase at the same time, then pick the real opening screen.
  // Waiting for both means the front page never flashes sample players
  // before the real leaderboard arrives.
  await Promise.all([
    loadTodaysQuestions(),
    withTimeout(connectFirebase(), 8, "connecting to Firebase").catch(function (err) {
      console.warn("QUIZ://01 — " + err.message + ", carrying on without it.");
    })
  ]);

  startImagePreload();     // pictures download while the player types their name
  showOpeningScreen();
}

/**
 * Re-reads today's players once, then updates both the count on the
 * front page and the top-3 box from that same list.
 */
async function refreshLiveNumbers() {
  const rows = await loadTodayRows();

  const countEl = document.getElementById("player-count");
  if (countEl) countEl.textContent = rows.length;

  renderTopThree(rows);
}

// Modules run after the page is parsed, but check anyway
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
