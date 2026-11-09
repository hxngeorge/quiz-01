/* =========================================================================
   QUIZ://01 — ADMIN PANEL LOGIC
   -------------------------------------------------------------------------
   This page loads firebase-config.js and app.js before this file, so it can
   reuse the exact same functions the game itself uses to read the Google
   Sheet and talk to Firebase — isSheetConfigured(), fetchSheetRows(),
   buildQuestionsFromRow(), connectFirebase(), todayKey(), sortToday(),
   rankBadge() and so on. That guarantees this page can never show a
   question as "fine" when the game would actually reject it: it's running
   the identical check, not a copy of it that could drift out of sync.

   app.js's own start-up (init()) checks the page it's running on and does
   nothing here — see the top of init() in app.js.

   What this page does:
     1. A sign-in gate (not real security — see the note in the HTML)
     2. Shows every dated row in the Sheet and whether it's filled in right
     3. Shows today's leaderboard, with reset and CSV export
     4. A short how-the-sheet-works reference
   ========================================================================= */

const GATE_KEY = "quizAdminUnlocked";   // sessionStorage — cleared when the tab closes
const THEME_KEY = "quizAdminTheme";     // localStorage — remembered between visits


/* =========================================================================
   DARK / LIGHT
   The game itself is always dark, but this is a page you might sit with in
   a bright room, so it can go either way. The choice is remembered; with
   no choice saved yet it follows whatever the device prefers.
   ========================================================================= */

function savedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch (err) {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("btn-theme");
  if (btn) {
    // the button shows what you'd switch TO, not what you're in
    btn.textContent = theme === "dark" ? "\u263E" : "\u2600";
    btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
}

function startTheme() {
  const saved = savedTheme();
  if (saved === "dark" || saved === "light") {
    applyTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (err) {
    /* ignore — it just won't be remembered next time */
  }
}


/* =========================================================================
   SIGN IN
   ========================================================================= */

function isUnlocked() {
  try {
    return sessionStorage.getItem(GATE_KEY) === "true";
  } catch (err) {
    return false;        // private browsing etc. — just ask again, harmless
  }
}

function handleGateSubmit(event) {
  event.preventDefault();
  const typed = document.getElementById("gate-password").value;
  const errorEl = document.getElementById("gate-error");

  if (typed !== ADMIN_PASSWORD) {
    errorEl.textContent = "That's not the password in firebase-config.js.";
    return;
  }

  try {
    sessionStorage.setItem(GATE_KEY, "true");
  } catch (err) {
    /* ignore — the page still unlocks for this view, just won't remember it */
  }
  showPanel();
}

function signOut() {
  try {
    sessionStorage.removeItem(GATE_KEY);
  } catch (err) {
    /* ignore */
  }
  location.reload();
}

/** Reveals the dashboard and kicks off both of its sections. */
function showPanel() {
  document.getElementById("gate").hidden = true;
  document.getElementById("panel").hidden = false;
  document.getElementById("admin-today").textContent = todayLabel();
  refreshSheetSection();
  refreshLeaderboardSection();
}


/* =========================================================================
   SECTION 1 — GOOGLE SHEET
   ========================================================================= */

// Remembers the questions built from whichever row is selected, so the
// detail view and the "is today's quiz live?" banner both read from one
// place instead of re-parsing.
let sheetRows = [];        // [{ date, status, isToday, ok, questions|error }]
let selectedRowIndex = -1;

async function refreshSheetSection() {
  const unconfigured = document.getElementById("sheet-unconfigured");
  const configured   = document.getElementById("sheet-configured");

  if (!isSheetConfigured()) {
    unconfigured.hidden = false;
    configured.hidden = true;
    document.getElementById("btn-refetch").disabled = true;
    return;
  }

  unconfigured.hidden = true;
  configured.hidden = false;
  document.getElementById("sheet-id-display").value = SHEET_ID;
  document.getElementById("sheet-open-link").href =
    "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(SHEET_ID) + "/edit";

  await fetchAndRenderSheet();
}

async function fetchAndRenderSheet() {
  const statusEl = document.getElementById("sheet-status");
  const rowsWrap = document.getElementById("sheet-rows-wrap");
  const btn = document.getElementById("btn-refetch");

  btn.disabled = true;
  statusEl.innerHTML = '<p class="muted">Fetching…</p>';
  rowsWrap.hidden = true;

  let rawRows;
  try {
    rawRows = await fetchSheetRows();
  } catch (err) {
    // fetchSheetRows() already gives a precise reason for the common
    // causes (opened as a file, offline/blocked, Sheet not shared) — only
    // add the generic "check sharing" reminder for anything else.
    const diagnosed = location.protocol === "file:";
    statusEl.innerHTML = banner("bad",
      "Couldn't read the Sheet: " + escapeHtml(err.message) +
      (diagnosed ? "" : ". If that doesn't explain it, double-check it's shared as " +
        "“Anyone with the link” (Viewer)."));
    btn.disabled = false;
    return;
  }

  const today = todayKey();
  sheetRows = rawRows
    .filter(function (row) { return cellText(row.date) !== ""; })   // skip blank template rows
    .map(function (row) {
      const date = normalizeSheetDate(row.date);
      const status = cellText(row.status).toLowerCase();
      const entry = {
        date: date,
        status: status,
        isToday: date === today,
        // the raw question text, so a row that won't parse is still
        // recognisable in the table instead of showing three dashes
        rawText: [1, 2, 3].map(function (n) { return cellText(row["q" + n + "_text"]); })
      };
      try {
        entry.ok = true;
        entry.questions = buildQuestionsFromRow(row);
      } catch (err) {
        entry.ok = false;
        entry.error = err.message;
      }
      return entry;
    });

  if (sheetRows.length === 0) {
    statusEl.innerHTML = banner("warn", "No dated rows found yet — add a row with today's date to get started.");
    btn.disabled = false;
    return;
  }

  const liveToday = sheetRows.find(function (r) { return r.isToday && r.status === "live" && r.ok; });
  const todayLooksRight = sheetRows.some(function (r) { return r.isToday; });

  if (liveToday) {
    statusEl.innerHTML = banner("good", "Today's quiz (" + todayLabel() + ") is live and reads correctly.");
  } else if (!todayLooksRight) {
    statusEl.innerHTML = banner("warn", "No row is dated today (" + todayLabel() +
      ") yet. Players are seeing the built-in sample questions.");
  } else {
    const todays = sheetRows.filter(function (r) { return r.isToday; });
    const reason = todays.every(function (r) { return r.status !== "live"; })
      ? 'today’s row isn’t marked "live" yet'
      : "today's row doesn't read correctly (see below)";
    statusEl.innerHTML = banner("warn", "Today (" + todayLabel() + ") isn't showing the real quiz yet — " +
      reason + ". Players are seeing the built-in sample questions.");
  }

  renderSheetTable();
  rowsWrap.hidden = false;
  btn.disabled = false;

  // Select today's row if there is one, else the first row
  const defaultIndex = sheetRows.findIndex(function (r) { return r.isToday; });
  selectSheetRow(defaultIndex === -1 ? 0 : defaultIndex);
}

function renderSheetTable() {
  const body = document.getElementById("sheet-rows");
  body.innerHTML = "";

  sheetRows.forEach(function (row, index) {
    const tr = document.createElement("tr");
    tr.dataset.index = index;
    tr.addEventListener("click", function () { selectSheetRow(index); });

    const qCell = function (n) {
      const text = row.ok ? row.questions[n - 1].text : row.rawText[n - 1];
      if (!text) return "—";
      return text.length > 34 ? text.slice(0, 34) + "…" : text;
    };

    tr.innerHTML =
      "<td>" + escapeHtml(row.date) + (row.isToday ? ' <span class="pill pill--muted">TODAY</span>' : "") + "</td>" +
      "<td>" + statusPill(row.status) + "</td>" +
      "<td>" + escapeHtml(qCell(1)) + "</td>" +
      "<td>" + escapeHtml(qCell(2)) + "</td>" +
      "<td>" + escapeHtml(qCell(3)) + "</td>" +
      "<td>" + (row.ok
        ? '<span class="pill pill--good">OK</span>'
        : '<span class="pill pill--bad" title="' + escapeHtml(row.error) + '">PROBLEM</span>') + "</td>";
    body.appendChild(tr);
  });
}

function statusPill(status) {
  if (status === "live") return '<span class="pill pill--good">live</span>';
  if (status === "draft") return '<span class="pill pill--warn">draft</span>';
  if (status === "archived") return '<span class="pill pill--muted">archived</span>';
  return '<span class="pill pill--bad">"' + escapeHtml(status) + '"?</span>';
}

function selectSheetRow(index) {
  selectedRowIndex = index;
  document.querySelectorAll("#sheet-rows tr").forEach(function (tr) {
    tr.classList.toggle("is-selected", Number(tr.dataset.index) === index);
  });
  renderSheetDetail(sheetRows[index]);
}

/** The full breakdown of one row's three questions — or its error. */
function renderSheetDetail(row) {
  const el = document.getElementById("sheet-detail");
  if (!row) { el.innerHTML = ""; return; }

  if (!row.ok) {
    el.innerHTML = banner("bad", "This row won't reach players: " + escapeHtml(row.error));
    return;
  }

  el.innerHTML = row.questions.map(function (q, i) {
    return questionDetailHtml(q, i + 1);
  }).join("");
}

function questionDetailHtml(question, n) {
  let body = "<h4>Q" + n + " — " + escapeHtml(question.type === "mcq" ? "multiple choice" : "typed") +
             " · " + question.points + " pts</h4>" +
             "<p>" + escapeHtml(question.text) + "</p>";

  if (question.image) {
    body += '<img src="' + escapeHtml(question.image) + '" alt="Picture for Q' + n + '" ' +
            'onerror="this.replaceWith(Object.assign(document.createElement(\'p\'),' +
            '{className:\'muted\',textContent:\'Picture didn\\u2019t load: \' + this.src}))">';
  }

  if (question.type === "mcq") {
    const letters = ["A", "B", "C", "D"];
    body += question.options.map(function (opt, i) {
      const correct = i === question.correct;
      return '<div class="opt' + (correct ? " is-correct" : "") + '">' +
             letters[i] + ". " + escapeHtml(opt) + (correct ? " ✓" : "") + "</div>";
    }).join("");
  } else {
    partsOf(question).forEach(function (part, i) {
      body += '<div class="part"><b>Part ' + (i + 1) + ':</b> accepts ' +
              part.answers.map(escapeHtml).join(", ") + " — " + part.points + " pts</div>";
    });
  }

  return '<div class="q-detail">' + body + "</div>";
}


/* =========================================================================
   SECTION 2 — LEADERBOARD MANAGEMENT
   ========================================================================= */

async function refreshLeaderboardSection() {
  const unconfigured = document.getElementById("firebase-unconfigured");

  if (!isFirebaseConfigured()) {
    unconfigured.hidden = false;
    document.getElementById("board-wrap").hidden = true;
    document.getElementById("alltime-wrap").hidden = true;
    document.getElementById("btn-reset").disabled = true;
    document.getElementById("btn-export").disabled = true;
    return;
  }

  unconfigured.hidden = true;
  await connectFirebase();

  if (!firebase.ready) {
    unconfigured.hidden = false;
    unconfigured.textContent = "Couldn't connect to Firebase — check the values in firebase-config.js.";
    return;
  }

  await Promise.all([loadTodayTable(), loadAllTimeTable()]);
}

/** Like app.js's readTodayScores(), but keeps each document's id so a row can be deleted. */
async function readTodayScoresWithIds() {
  const { collection, getDocs } = firebase.fns;
  const snapshot = await getDocs(collection(firebase.db, "daily", todayKey(), "scores"));
  return snapshot.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
}

/** Like app.js's readAllTime(), but keeps each document's id. */
async function readAllTimeWithIds() {
  const { collection, getDocs } = firebase.fns;
  const snapshot = await getDocs(collection(firebase.db, "alltime"));
  return snapshot.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
}

async function deleteTodayScore(id) {
  const { doc, deleteDoc } = firebase.fns;
  await deleteDoc(doc(firebase.db, "daily", todayKey(), "scores", id));
}

let todaysRows = [];   // kept at module scope so Export can read exactly what's on screen

async function loadTodayTable() {
  const wrap = document.getElementById("board-wrap");
  const body = document.getElementById("today-rows");
  const empty = document.getElementById("today-empty");

  wrap.hidden = false;
  todaysRows = sortToday(await readTodayScoresWithIds());

  body.innerHTML = "";
  empty.hidden = todaysRows.length > 0;

  todaysRows.forEach(function (row, i) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + rankBadge(i + 1) + "</td>" +
      "<td>" + escapeHtml(row.name) + "</td>" +
      '<td class="num">' + row.points + "</td>" +
      '<td class="num">' + escapeHtml(row.time_display || "") + "</td>" +
      '<td><button class="small" data-remove="' + escapeHtml(row.id) + '" ' +
      'title="Remove just this player’s score for today">Remove</button></td>';
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-remove]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const row = todaysRows.find(function (r) { return r.id === btn.dataset.remove; });
      if (!row) return;
      if (!confirm('Remove ' + row.name + '’s score for today? This can’t be undone.')) return;
      btn.disabled = true;
      await deleteTodayScore(row.id);
      await loadTodayTable();
    });
  });
}

async function loadAllTimeTable() {
  const wrap = document.getElementById("alltime-wrap");
  const body = document.getElementById("alltime-rows");
  const empty = document.getElementById("alltime-empty");

  wrap.hidden = false;
  const rows = (await readAllTimeWithIds()).sort(function (a, b) {
    return (b.total_points || 0) - (a.total_points || 0);
  });

  body.innerHTML = "";
  empty.hidden = rows.length > 0;

  rows.forEach(function (row) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + escapeHtml(row.name) + "</td>" +
      '<td class="num">' + (row.total_points || 0) + "</td>" +
      '<td class="num">' + (row.days_played || 0) + "</td>";
    body.appendChild(tr);
  });
}

async function resetTodaysScores() {
  if (todaysRows.length === 0) {
    alert("There's nothing to reset — nobody has played today yet.");
    return;
  }
  const sure = confirm(
    "Delete all " + todaysRows.length + " of today's scores?\n\n" +
    "This can't be undone. All-Time totals are not affected."
  );
  if (!sure) return;

  const btn = document.getElementById("btn-reset");
  btn.disabled = true;
  try {
    for (const row of todaysRows) {
      await deleteTodayScore(row.id);
    }
    await loadTodayTable();
  } finally {
    btn.disabled = false;
  }
}

function exportTodaysResults() {
  const header = "rank,name,points,time\n";
  const lines = todaysRows.map(function (row, i) {
    return [i + 1, csvField(row.name), row.points, csvField(row.time_display || "")].join(",");
  });

  const blob = new Blob([header + lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "quiz-01_scores_" + todayKey() + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Wraps a CSV field in quotes if it contains a comma, quote or newline. */
function csvField(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}


/* =========================================================================
   SMALL HELPERS
   ========================================================================= */

function banner(kind, text) {
  return '<div class="banner banner--' + kind + '">' + escapeHtml(text) + "</div>";
}

/** Escapes text before it's dropped into innerHTML — question text, sheet
 *  errors and player names all ultimately come from outside this page. */
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}


/* =========================================================================
   START-UP
   ========================================================================= */

function initAdmin() {
  startTheme();
  document.getElementById("gate-form").addEventListener("submit", handleGateSubmit);
  document.getElementById("btn-signout").addEventListener("click", signOut);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  document.getElementById("btn-refetch").addEventListener("click", fetchAndRenderSheet);
  document.getElementById("btn-reset").addEventListener("click", resetTodaysScores);
  document.getElementById("btn-export").addEventListener("click", exportTodaysResults);

  if (isUnlocked()) {
    showPanel();
  } else {
    document.getElementById("gate-password").focus();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}
