require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const sheetsClient = require("./src/sheet");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.set("trust proxy", 1); // needed on Render/behind a proxy for secure cookies to work

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

app.use(express.static(path.join(__dirname, "src")));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: "Admin login required." });
}

// ---- Auth -----------------------------------------------------------

app.get("/api/session", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Server has no ADMIN_PASSWORD configured." });
  }
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong password." });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- Public read -------------------------------------------------------

app.get("/api/state", async (req, res) => {
  try {
    const [players, matches] = await Promise.all([sheetsClient.getPlayers(), sheetsClient.getMatches()]);
    res.json({ players, matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the league from Google Sheets." });
  }
});

// ---- Admin-only writes -----------------------------------------------

app.post("/api/players", requireAdmin, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Player name is required." });

    const result = await sheetsClient.addPlayer(name);
    if (!result.ok) return res.status(409).json({ error: "That player is already in the table." });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save the player to Google Sheets." });
  }
});

app.delete("/api/players/:name", requireAdmin, async (req, res) => {
  try {
    await sheetsClient.deletePlayer(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove the player." });
  }
});

app.post("/api/matches", requireAdmin, async (req, res) => {
  try {
    const { a, b } = req.body;
    const scoreA = Number(req.body.scoreA);
    const scoreB = Number(req.body.scoreB);

    if (!a || !b || a === b) return res.status(400).json({ error: "Pick two different players." });
    if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      return res.status(400).json({ error: "Scores must be zero or a positive number." });
    }

    const players = await sheetsClient.getPlayers();
    if (!players.includes(a) || !players.includes(b)) {
      return res.status(400).json({ error: "Both players must already be in the table." });
    }

    await sheetsClient.addMatch({ a, b, scoreA, scoreB });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save the match." });
  }
});

// The round-robin/scheduling logic runs in the browser (it's pure data
// shaping, nothing security-sensitive) — this endpoint just persists
// the fixture list it computed, in one read+write instead of many.
app.post("/api/matches/bulk", requireAdmin, async (req, res) => {
  try {
    const fixtures = Array.isArray(req.body.fixtures) ? req.body.fixtures : [];
    if (!fixtures.length) return res.status(400).json({ error: "No fixtures provided." });
    await sheetsClient.addFixturesBulk(fixtures);
    res.status(201).json({ ok: true, count: fixtures.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save the fixtures." });
  }
});

app.patch("/api/matches/:id", requireAdmin, async (req, res) => {
  try {
    const scoreA = Number(req.body.scoreA);
    const scoreB = Number(req.body.scoreB);
    if (Number.isNaN(scoreA) || Number.isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
      return res.status(400).json({ error: "Scores must be zero or a positive number." });
    }
    const result = await sheetsClient.updateMatch(req.params.id, { scoreA, scoreB });
    if (!result.ok) return res.status(404).json({ error: "Match not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update the match." });
  }
});

app.delete("/api/matches/:id", requireAdmin, async (req, res) => {
  try {
    await sheetsClient.deleteMatch(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete the match." });
  }
});

app.post("/api/reset", requireAdmin, async (req, res) => {
  try {
    await sheetsClient.resetSeason();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not reset the season." });
  }
});

app.listen(PORT, () => {
  console.log(`eFootball Liberia server running on http://localhost:${PORT}`);
});