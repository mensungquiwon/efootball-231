// ---------------------------------------------------------------
// eFootball Liberia — league table, fixtures & results
// LIVE VERSION: the Google Sheet (via the Express API) is the single
// source of truth. Every visitor sees the same data. Only an admin
// (logged in via the password form) can add/edit/delete anything.
// ---------------------------------------------------------------

const AVATAR_COLORS = ["#e8b23a", "#6fb3d2", "#c8102e", "#8bc34a", "#d78ec9", "#f2a65a", "#7986cb"];

/** @type {{ players: string[], matches: { id: string, a: string, b: string, scoreA: number|null, scoreB: number|null, played: boolean, scheduledTime: string|null }[] }} */
let state = { players: [], matches: [] };
let isAdmin = false;
let editingMatchId = null;

// ---- Server communication ------------------------------------------

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function refreshState() {
  state = await fetchJSON("/api/state");
}

async function refreshSession() {
  const data = await fetchJSON("/api/session");
  isAdmin = !!data.isAdmin;
}

async function refreshAndRender() {
  await Promise.all([refreshState(), refreshSession()]);
  render();
}

// ---- Standings algorithm -----------------------------------------

/**
 * Build the P/W/D/L/GF/GA/GD/Pts row for every player from PLAYED
 * matches, then sort into table order.
 *
 * Tie-break order (standard football convention):
 *   1. Points (desc)
 *   2. Goal difference (desc)
 *   3. Goals for (desc)
 *   4. Name (asc) — final stable tiebreak so order never flickers
 */
function computeStandings() {
  const table = new Map();

  for (const name of state.players) {
    table.set(name, { name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });
  }

  for (const m of state.matches) {
    if (!m.played) continue;
    const rowA = table.get(m.a);
    const rowB = table.get(m.b);
    if (!rowA || !rowB) continue;

    rowA.played++;
    rowB.played++;
    rowA.gf += m.scoreA;
    rowA.ga += m.scoreB;
    rowB.gf += m.scoreB;
    rowB.ga += m.scoreA;

    if (m.scoreA > m.scoreB) {
      rowA.won++;
      rowB.lost++;
    } else if (m.scoreA < m.scoreB) {
      rowB.won++;
      rowA.lost++;
    } else {
      rowA.drawn++;
      rowB.drawn++;
    }
  }

  const rows = Array.from(table.values()).map((r) => ({
    ...r,
    gd: r.gf - r.ga,
    pts: r.won * 3 + r.drawn * 1,
  }));

  rows.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    return x.name.localeCompare(y.name);
  });

  return rows;
}

function recentForm(name, limit = 3) {
  const results = [];
  for (const m of state.matches) {
    if (!m.played) continue;
    if (m.a === name) results.push(m.scoreA > m.scoreB ? "W" : m.scoreA < m.scoreB ? "L" : "D");
    else if (m.b === name) results.push(m.scoreB > m.scoreA ? "W" : m.scoreB < m.scoreA ? "L" : "D");
  }
  return results.slice(-limit);
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener("animationend", () => toast.remove());
}

// ---- Rendering ----------------------------------------------------

function render() {
  document.body.classList.toggle("is-admin", isAdmin);
  document.getElementById("login-toggle").classList.toggle("is-admin", isAdmin);
  document.getElementById("login-toggle").textContent = isAdmin ? "🔓 Log out" : "🔒 Admin";

  renderTable();
  renderPlayerSelects();
  renderFixturesAndResults();
  renderRoster();
  renderMatchdayCount();
}

function renderTable() {
  const tbody = document.getElementById("table-body");
  const emptyState = document.getElementById("empty-state");
  const standings = computeStandings();

  tbody.innerHTML = "";

  if (standings.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  const total = standings.length;
  const topZoneSize = total >= 5 ? 3 : 0;
  const bottomZoneSize = total >= 6 ? 3 : 0;

  standings.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.classList.add("rank-1");
    if (i < topZoneSize) tr.classList.add("zone-top");
    else if (i >= total - bottomZoneSize) tr.classList.add("zone-bottom");
    tr.style.animationDelay = `${Math.min(i, 10) * 45}ms`;

    const form = recentForm(row.name);
    const formHtml = form.length
      ? `<span class="form-pills">${form.map((r) => `<span class="pill ${r.toLowerCase()}">${r}</span>`).join("")}</span>`
      : `<span class="form-pills"></span>`;

    tr.innerHTML = `
      <td class="pos-cell">${i + 1}</td>
      <td class="name-cell">
        <span class="player-cell">
          <span class="avatar" style="background:${avatarColor(row.name)}">${initialsFor(row.name)}</span>
          ${escapeHtml(row.name)}
          ${i === 0 ? '<span class="trophy">🏆</span>' : ""}
        </span>
      </td>
      <td class="form-cell">${formHtml}</td>
      <td class="pts-cell">${row.pts}</td>
      <td>${row.played}</td>
      <td>${row.won}</td>
      <td>${row.drawn}</td>
      <td>${row.lost}</td>
      <td>${row.gf}</td>
      <td>${row.ga}</td>
      <td>${row.gd > 0 ? "+" + row.gd : row.gd}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPlayerSelects() {
  const selects = [document.getElementById("player-a"), document.getElementById("player-b")];
  selects.forEach((select) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = "";
    if (state.players.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "Add players first";
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
      return;
    }
    for (const name of state.players) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (state.players.includes(current)) select.value = current;
  });
}

function renderFixturesAndResults() {
  const fixturesList = document.getElementById("fixtures-list");
  const fixturesEmpty = document.getElementById("fixtures-empty");
  const resultsList = document.getElementById("results-list");
  const resultsEmpty = document.getElementById("results-empty");

  fixturesList.innerHTML = "";
  resultsList.innerHTML = "";

  const unplayed = state.matches.filter((m) => !m.played);
  const played = state.matches.filter((m) => m.played);

  fixturesEmpty.hidden = unplayed.length > 0;
  unplayed.forEach((m) => {
    const li = document.createElement("li");
    li.dataset.matchId = m.id;
    const timeLabel = m.scheduledTime
      ? `<span class="fixture-time" style="display:block; font-size:0.85rem; opacity:0.8;">📅 ${escapeHtml(m.scheduledTime)}</span>`
      : "";

    if (isAdmin) {
      li.innerHTML = `
        <div style="width:100%">
          <div>${escapeHtml(m.a)} vs ${escapeHtml(m.b)}</div>
          ${timeLabel}
          <form class="edit-match-form submit-score-form" data-match-id="${m.id}" style="margin-top:8px;">
            <input type="number" min="0" class="edit-score-a" placeholder="0" required>
            <span class="vs">-</span>
            <input type="number" min="0" class="edit-score-b" placeholder="0" required>
            <button type="submit" class="mini-btn save-btn">Submit result</button>
            <button type="button" class="icon-btn danger" data-action="delete-match" title="Delete fixture">✕</button>
          </form>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div>
          <span>${escapeHtml(m.a)} vs ${escapeHtml(m.b)}</span>
          ${timeLabel}
        </div>
        <span class="score">Scheduled</span>
      `;
    }
    fixturesList.appendChild(li);
  });

  resultsEmpty.hidden = played.length > 0;
  [...played].reverse().forEach((m) => {
    const li = document.createElement("li");
    li.dataset.matchId = m.id;

    if (isAdmin && editingMatchId === m.id) {
      li.classList.add("editing");
      li.innerHTML = `
        <form class="edit-match-form" data-match-id="${m.id}">
          <span class="edit-side">${escapeHtml(m.a)}</span>
          <input type="number" min="0" class="edit-score-a" value="${m.scoreA}" required>
          <span class="vs">–</span>
          <input type="number" min="0" class="edit-score-b" value="${m.scoreB}" required>
          <span class="edit-side">${escapeHtml(m.b)}</span>
          <button type="submit" class="mini-btn save-btn">Save</button>
          <button type="button" class="mini-btn cancel-btn" data-action="cancel-edit">Cancel</button>
        </form>
      `;
    } else {
      const actionsHtml = isAdmin
        ? `<span class="row-actions">
            <button type="button" class="icon-btn" data-action="edit-match" title="Edit result">✎</button>
            <button type="button" class="icon-btn danger" data-action="delete-match" title="Delete result">✕</button>
          </span>`
        : "";
      li.innerHTML = `
        <span>${escapeHtml(m.a)} vs ${escapeHtml(m.b)}</span>
        <span class="score">${m.scoreA} – ${m.scoreB}</span>
        ${actionsHtml}
      `;
    }
    resultsList.appendChild(li);
  });
}

function renderRoster() {
  const list = document.getElementById("roster-list");
  const empty = document.getElementById("roster-empty");
  const countEl = document.getElementById("roster-count");
  list.innerHTML = "";
  countEl.textContent = state.players.length;

  if (state.players.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  state.players.forEach((name) => {
    const upcoming = state.matches.filter((m) => !m.played && (m.a === name || m.b === name)).slice(0, 3);
    const scheduleHtml = upcoming.length
      ? `<div style="font-size:0.8rem; margin-top:4px; opacity:0.85;">
          ${upcoming.map((g) => `<div>vs ${escapeHtml(g.a === name ? g.b : g.a)} (${escapeHtml(g.scheduledTime || "TBD")})</div>`).join("")}
         </div>`
      : `<div style="font-size:0.8rem; margin-top:4px; opacity:0.6;">No upcoming matches</div>`;

    const li = document.createElement("li");
    li.style.flexDirection = "column";
    li.style.alignItems = "flex-start";
    li.innerHTML = `
      <div style="display:flex; width:100%; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="avatar" style="background:${avatarColor(name)}">${initialsFor(name)}</span>
          <span class="roster-name" style="font-weight:600;">${escapeHtml(name)}</span>
        </div>
        <button type="button" class="icon-btn danger" data-action="remove-player" data-name="${escapeHtml(name)}" title="Remove player">✕</button>
      </div>
      ${scheduleHtml}
    `;
    list.appendChild(li);
  });
}

function renderMatchdayCount() {
  const playedCount = state.matches.filter((m) => m.played).length;
  document.getElementById("matchday-count").textContent = `${playedCount} match${playedCount === 1 ? "" : "es"} played`;
}

// ---- Login/logout -------------------------------------------------

const loginToggle = document.getElementById("login-toggle");
const loginPanel = document.getElementById("login-panel");

loginToggle.addEventListener("click", async () => {
  if (isAdmin) {
    await fetchJSON("/api/logout", { method: "POST" });
    isAdmin = false;
    editingMatchId = null;
    render();
    showToast("Logged out.");
    return;
  }
  loginPanel.hidden = !loginPanel.hidden;
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  const password = document.getElementById("admin-password").value;

  try {
    await fetchJSON("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    isAdmin = true;
    loginPanel.hidden = true;
    e.target.reset();
    render();
    showToast("🔓 Admin mode on.");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

// ---- Tab switching -------------------------------------------------

const tabBar = document.getElementById("tab-bar");
const menuToggle = document.getElementById("menu-toggle");
const menuToggleLabel = document.getElementById("menu-toggle-label");

menuToggle.addEventListener("click", () => {
  const isOpen = tabBar.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

tabBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  const target = btn.dataset.tab;

  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.hidden = p.dataset.panel !== target;
  });

  menuToggleLabel.textContent = btn.textContent;
  tabBar.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

document.addEventListener("click", (e) => {
  if (!tabBar.classList.contains("open")) return;
  if (tabBar.contains(e.target) || menuToggle.contains(e.target)) return;
  tabBar.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
});

// ---- Admin actions --------------------------------------------------

document.getElementById("add-player-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("player-name");
  const name = input.value.trim();
  if (!name) return;

  try {
    await fetchJSON("/api/players", { method: "POST", body: JSON.stringify({ name }) });
    input.value = "";
    await refreshAndRender();
    showToast(`🎉 Welcome, ${name}!`);
  } catch (err) {
    input.setCustomValidity(err.message);
    input.reportValidity();
  }
});

document.getElementById("bulk-add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const textarea = document.getElementById("bulk-names");
  const summary = document.getElementById("bulk-summary");
  const names = textarea.value.split(/[\n,]/).map((n) => n.trim()).filter(Boolean);

  let addedCount = 0;
  let skippedCount = 0;
  for (const name of names) {
    try {
      await fetchJSON("/api/players", { method: "POST", body: JSON.stringify({ name }) });
      addedCount++;
    } catch {
      skippedCount++;
    }
  }

  summary.textContent = `Added ${addedCount} player${addedCount === 1 ? "" : "s"}${skippedCount ? `, skipped ${skippedCount} (blank or already in the table)` : ""}.`;
  summary.hidden = false;
  textarea.value = "";
  await refreshAndRender();
  if (addedCount > 0) showToast(`🎉 ${addedCount} player${addedCount === 1 ? "" : "s"} added!`);
});

document.getElementById("record-match-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("match-error");
  errorEl.hidden = true;

  const a = document.getElementById("player-a").value;
  const b = document.getElementById("player-b").value;
  const scoreA = document.getElementById("score-a").value;
  const scoreB = document.getElementById("score-b").value;

  try {
    await fetchJSON("/api/matches", { method: "POST", body: JSON.stringify({ a, b, scoreA, scoreB }) });
    e.target.reset();
    await refreshAndRender();
    showToast(`⚽ FT: ${a} ${scoreA} – ${scoreB} ${b}`);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

// Generates a proper round-robin schedule using the "circle method":
// one player stays fixed, everyone else rotates around them each
// round, so every player plays exactly once per round (no one sits
// idle while someone else plays 6 games in a row). Doubled for a
// home-and-away double round-robin, then handed to the server in
// one call.
document.getElementById("generate-fixtures-btn").addEventListener("click", async () => {
  if (state.players.length < 2) {
    alert("Add at least 2 players to generate fixtures.");
    return;
  }

  let roster = [...state.players];
  const hasBye = roster.length % 2 !== 0;
  if (hasBye) roster.push(null); // odd number of players: one sits out each round
  const n = roster.length;
  const numRounds = n - 1;

  const legOneRounds = [];
  let rotating = [...roster];
  for (let r = 0; r < numRounds; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const p1 = rotating[i];
      const p2 = rotating[n - 1 - i];
      if (p1 !== null && p2 !== null) pairs.push({ a: p1, b: p2 });
    }
    legOneRounds.push(pairs);
    const fixed = rotating[0];
    const rest = rotating.slice(1);
    rest.unshift(rest.pop());
    rotating = [fixed, ...rest];
  }

  // Leg two: same pairings, reversed — the away/return fixtures.
  const legTwoRounds = legOneRounds.map((round) => round.map((p) => ({ a: p.b, b: p.a })));
  const allRounds = [...legOneRounds, ...legTwoRounds];

  // Skip any exact directed pairing (this specific home/away order)
  // that's already scheduled or played, in case Generate gets clicked twice.
  const existing = new Set(state.matches.map((m) => `${m.a}|${m.b}`));

  // The whole season has to fit between today and "Sunday next week" —
  // i.e. not this coming Sunday, but the one after it.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilThisSunday = (7 - today.getDay()) % 7;
  const thisSunday = new Date(today);
  thisSunday.setDate(today.getDate() + daysUntilThisSunday);
  const seasonEnd = new Date(thisSunday);
  seasonEnd.setDate(thisSunday.getDate() + 7);

  const availableDays = Math.round((seasonEnd - today) / 86400000) + 1; // inclusive of both ends
  const roundsPerDay = Math.max(1, Math.ceil(allRounds.length / availableDays));

  const fixtures = [];
  allRounds.forEach((round, roundIndex) => {
    const dayOffset = Math.min(Math.floor(roundIndex / roundsPerDay), availableDays - 1);
    const matchDate = new Date(today);
    matchDate.setDate(today.getDate() + dayOffset);
    const dateString = matchDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    round.forEach((pair) => {
      const key = `${pair.a}|${pair.b}`;
      if (existing.has(key)) return;
      fixtures.push({
        a: pair.a,
        b: pair.b,
        scheduledTime: `Matchday ${roundIndex + 1} · ${dateString}`,
      });
    });
  });

  if (fixtures.length === 0) {
    alert("All home-and-away fixtures have already been generated!");
    return;
  }

  try {
    await fetchJSON("/api/matches/bulk", { method: "POST", body: JSON.stringify({ fixtures }) });
    await refreshAndRender();
    showToast(`📅 Scheduled ${fixtures.length} fixtures across ${allRounds.length} matchdays, ending ${seasonEnd.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}!`);
  } catch (err) {
    alert(err.message);
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest(".edit-match-form");
  if (!form) return;
  e.preventDefault();

  const id = form.dataset.matchId;
  const scoreA = form.querySelector(".edit-score-a").value;
  const scoreB = form.querySelector(".edit-score-b").value;

  try {
    await fetchJSON(`/api/matches/${id}`, { method: "PATCH", body: JSON.stringify({ scoreA, scoreB }) });
    editingMatchId = null;
    await refreshAndRender();
    showToast(`⚽ Result saved!`);
  } catch (err) {
    alert(err.message);
  }
});

document.addEventListener("click", async (e) => {
  const editBtn = e.target.closest('[data-action="edit-match"]');
  const deleteBtn = e.target.closest('[data-action="delete-match"]');
  const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
  const removePlayerBtn = e.target.closest('[data-action="remove-player"]');

  if (editBtn) {
    editingMatchId = editBtn.closest("li").dataset.matchId;
    renderFixturesAndResults();
  } else if (cancelBtn) {
    editingMatchId = null;
    renderFixturesAndResults();
  } else if (deleteBtn) {
    const id = deleteBtn.closest("li").dataset.matchId;
    if (!confirm("Delete this match/fixture?")) return;
    try {
      await fetchJSON(`/api/matches/${id}`, { method: "DELETE" });
      await refreshAndRender();
    } catch (err) {
      alert(err.message);
    }
  } else if (removePlayerBtn) {
    const name = removePlayerBtn.dataset.name;
    const playedCount = state.matches.filter((m) => m.a === name || m.b === name).length;
    const warning = playedCount ? ` They have ${playedCount} recorded match${playedCount === 1 ? "" : "es"} — removing them also removes those.` : "";
    if (!confirm(`Remove ${name}?${warning}`)) return;
    try {
      await fetchJSON(`/api/players/${encodeURIComponent(name)}`, { method: "DELETE" });
      await refreshAndRender();
    } catch (err) {
      alert(err.message);
    }
  }
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("Reset the whole season? This clears all players and results in the Sheet.")) return;
  try {
    await fetchJSON("/api/reset", { method: "POST" });
    await refreshAndRender();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Init -------------------------------------------------------

refreshAndRender().catch((err) => {
  console.error(err);
  document.getElementById("empty-state").hidden = false;
  document.getElementById("empty-state").textContent = "Could not reach the server. Is it running?";
});