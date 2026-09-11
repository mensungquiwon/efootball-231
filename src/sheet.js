// sheets.js
// The Sheet is the single source of truth. Every mutation reads the
// relevant tab fully, changes it in memory, and writes the whole
// thing back — simple and safe to reason about at this league's
// scale (a handful of players, at most a few dozen matches).
//
// Expected spreadsheet layout (two tabs):
//   "Players" tab -> column A: Name                                          (row 1 = header)
//   "Matches" tab -> columns A-G: MatchID | PlayerA | PlayerB | ScoreA | ScoreB | Played | ScheduledTime   (row 1 = header)

const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

if (!SPREADSHEET_ID) {
  console.warn("Warning: SHEET_ID is not set. Set it in your .env file.");
}

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set.");
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: "v4", auth });
}

// ---- Players ------------------------------------------------------

async function getPlayers() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Players!A2:A",
  });
  return (res.data.values || []).map((r) => r[0]).filter(Boolean);
}

async function writePlayers(sheets, players) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "Players!A2:A",
  });
  if (players.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "Players!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: players.map((p) => [p]) },
    });
  }
}

async function addPlayer(name) {
  const sheets = await getSheetsClient();
  const players = await getPlayers();
  if (players.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }
  players.push(name);
  await writePlayers(sheets, players);
  return { ok: true };
}

/** Removes a player AND any matches they're part of (their history no longer counts for opponents either). */
async function deletePlayer(name) {
  const sheets = await getSheetsClient();
  const players = (await getPlayers()).filter((p) => p !== name);
  await writePlayers(sheets, players);

  const matches = (await readMatches(sheets)).filter((m) => m.a !== name && m.b !== name);
  await writeMatches(sheets, matches);
}

// ---- Matches (a "match" is a fixture until played:true, then a result) --------

async function readMatches(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Matches!A2:G",
  });
  return (res.data.values || [])
    .filter((r) => r.length >= 3)
    .map((r) => ({
      id: r[0] || makeId(),
      a: r[1],
      b: r[2],
      scoreA: r[3] !== undefined && r[3] !== "" ? Number(r[3]) : null,
      scoreB: r[4] !== undefined && r[4] !== "" ? Number(r[4]) : null,
      played: r[5] === "TRUE" || r[5] === true,
      scheduledTime: r[6] || null,
    }));
}

async function writeMatches(sheets, matches) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: "Matches!A2:G",
  });
  if (matches.length) {
    const values = matches.map((m) => [
      m.id,
      m.a,
      m.b,
      m.scoreA === null || m.scoreA === undefined ? "" : m.scoreA,
      m.scoreB === null || m.scoreB === undefined ? "" : m.scoreB,
      m.played ? "TRUE" : "FALSE",
      m.scheduledTime || "",
    ]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "Matches!A2",
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
}

async function getMatches() {
  const sheets = await getSheetsClient();
  return readMatches(sheets);
}

/** Adds one manually-entered, already-played match. */
async function addMatch({ a, b, scoreA, scoreB }) {
  const sheets = await getSheetsClient();
  const matches = await readMatches(sheets);
  matches.push({
    id: makeId(),
    a,
    b,
    scoreA,
    scoreB,
    played: true,
    scheduledTime: "Manual entry",
  });
  await writeMatches(sheets, matches);
}

/** Adds many unplayed fixtures at once (used by the fixture generator) in a single read+write. */
async function addFixturesBulk(fixtures) {
  const sheets = await getSheetsClient();
  const matches = await readMatches(sheets);
  for (const f of fixtures) {
    matches.push({
      id: makeId(),
      a: f.a,
      b: f.b,
      scoreA: null,
      scoreB: null,
      played: false,
      scheduledTime: f.scheduledTime || null,
    });
  }
  await writeMatches(sheets, matches);
}

/** Submits a result for a fixture, or edits an already-played match's score. */
async function updateMatch(id, { scoreA, scoreB }) {
  const sheets = await getSheetsClient();
  const matches = await readMatches(sheets);
  const match = matches.find((m) => m.id === id);
  if (!match) return { ok: false, reason: "not-found" };
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.played = true;
  await writeMatches(sheets, matches);
  return { ok: true };
}

async function deleteMatch(id) {
  const sheets = await getSheetsClient();
  const matches = (await readMatches(sheets)).filter((m) => m.id !== id);
  await writeMatches(sheets, matches);
}

async function resetSeason() {
  const sheets = await getSheetsClient();
  await writePlayers(sheets, []);
  await writeMatches(sheets, []);
}

module.exports = {
  getPlayers,
  addPlayer,
  deletePlayer,
  getMatches,
  addMatch,
  addFixturesBulk,
  updateMatch,
  deleteMatch,
  resetSeason,
};