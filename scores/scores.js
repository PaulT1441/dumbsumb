/**
 * Leaderboard UI for Infinite Mario.
 *
 * - Shows the top 10 and global stats from the scores API (/api).
 * - Opens a dialog at the end of a game so the player can save their score.
 * - Exposes window.Leaderboard, used by the game through Mario.GameFinished()
 *   and Mario.IsInputCaptured() (see code/setup.js).
 *
 * The game keeps working if the API is down: the panel just says so.
 */
(function () {
  "use strict";

  var API = "/api";
  var REFRESH_MS = 30000;
  var NAME_KEY = "mario.playerName";

  var els = {};
  var pending = null;        // result of the game being saved
  var highlightId = null;    // id of the score just saved
  var open = false;

  // ---------- Small helpers ----------

  function $(id) { return document.getElementById(id); }

  function formatScore(n) {
    return (n | 0).toLocaleString("fr-FR");
  }

  function readName() {
    try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; }
  }

  function saveName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage unavailable */ }
  }

  function request(path, options) {
    return fetch(API + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || ("HTTP " + res.status));
          err.details = body.details;
          throw err;
        }
        return body;
      });
    });
  }

  function cell(text, className) {
    var td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  // ---------- Leaderboard panel ----------

  function setStatus(online) {
    els.status.textContent = online ? "En ligne" : "Hors ligne";
    els.status.className = "board-status " + (online ? "online" : "offline");
  }

  function renderScores(rows) {
    els.body.textContent = "";
    els.empty.hidden = rows.length > 0;
    els.table.hidden = rows.length === 0;

    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      if (row.rank <= 3) tr.className = "top-" + row.rank;
      if (row.id === highlightId) tr.className += " highlight";

      var rankTd = document.createElement("td");
      var rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = row.rank;
      rankTd.appendChild(rank);
      tr.appendChild(rankTd);

      var nameTd = cell(row.name, "player");
      nameTd.title = row.name + " — " + row.levels + " niveau(x), " + row.coins + " pièces, " + row.kills + " ennemis";
      if (row.outcome === "win") {
        var badge = document.createElement("span");
        badge.className = "badge-win";
        badge.textContent = "👑";
        badge.title = "Jeu terminé";
        nameTd.appendChild(badge);
      }
      tr.appendChild(nameTd);

      tr.appendChild(cell(formatScore(row.score), "num score-value"));
      tr.appendChild(cell(String(row.world), "num world"));
      els.body.appendChild(tr);
    });
  }

  function renderStats(stats) {
    els.statGames.textContent = formatScore(stats.games);
    els.statPlayers.textContent = formatScore(stats.players);
    els.statBest.textContent = formatScore(stats.best);
  }

  function refresh() {
    return Promise.all([request("/scores?limit=10"), request("/stats")])
      .then(function (res) {
        setStatus(true);
        renderScores(res[0]);
        renderStats(res[1]);
      })
      .catch(function () {
        setStatus(false);
        els.table.hidden = true;
        els.empty.hidden = false;
        els.empty.textContent = "Classement indisponible pour le moment.";
      });
  }

  function renderPoints() {
    if (!window.Mario || !Mario.Points) return;
    var p = Mario.Points;
    var items = [
      ["Pièce", p.Coin],
      ["Ennemi écrasé", p.Stomp],
      ["Ennemi touché (carapace / feu)", p.ShotKill],
      ["Champignon / fleur", p.PowerUp],
      ["Fin de niveau", p.LevelClear],
      ["Seconde restante", p.TimeBonus]
    ];
    els.points.textContent = "";
    items.forEach(function (it) {
      var li = document.createElement("li");
      var label = document.createElement("span");
      var value = document.createElement("span");
      label.textContent = it[0];
      value.textContent = "+" + it[1];
      li.appendChild(label);
      li.appendChild(value);
      els.points.appendChild(li);
    });
  }

  // ---------- Game-over dialog ----------

  function setMessage(text, kind) {
    els.message.textContent = text || "";
    els.message.className = "modal-message" + (kind ? " " + kind : "");
  }

  function openDialog(result) {
    pending = result;
    open = true;

    els.title.textContent = result.outcome === "win" ? "Victoire !" : "Game over";
    els.score.textContent = formatScore(result.score);
    els.details.textContent = "";
    [
      "Monde " + result.world,
      result.levels + " niveau" + (result.levels > 1 ? "x" : ""),
      result.coins + " pièce" + (result.coins > 1 ? "s" : ""),
      result.kills + " ennemi" + (result.kills > 1 ? "s" : "")
    ].forEach(function (t) {
      var span = document.createElement("span");
      span.textContent = t;
      els.details.appendChild(span);
    });

    els.input.value = readName();
    els.submit.disabled = false;
    els.skip.disabled = false;
    els.form.hidden = false;
    setMessage("");

    els.modal.hidden = false;
    setTimeout(function () { els.input.focus(); els.input.select(); }, 50);
  }

  function closeDialog() {
    els.modal.hidden = true;
    els.input.blur();
    pending = null;
    // Small delay so the key that closed the dialog is not seen by the game
    setTimeout(function () { open = false; }, 150);
  }

  function submit(event) {
    event.preventDefault();
    if (!pending) return;

    var name = els.input.value.trim();
    if (!name) {
      setMessage("Entre un pseudo pour enregistrer ton score.", "error");
      els.input.focus();
      return;
    }

    els.submit.disabled = true;
    els.skip.disabled = true;
    setMessage("Enregistrement…");

    var payload = {
      name: name,
      score: pending.score,
      world: pending.world,
      levels: pending.levels,
      coins: pending.coins,
      kills: pending.kills,
      outcome: pending.outcome
    };

    request("/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (saved) {
        saveName(name);
        highlightId = saved.id;
        els.form.hidden = true;
        setMessage("Score enregistré : tu es " + saved.rank + (saved.rank === 1 ? "er" : "e") + " au classement !", "success");
        refresh();
        setTimeout(closeDialog, 1800);
      })
      .catch(function (err) {
        var detail = err.details && err.details.length ? " (" + err.details[0] + ")" : "";
        setMessage("Impossible d'enregistrer : " + err.message + detail, "error");
        els.submit.disabled = false;
        els.skip.disabled = false;
      });
  }

  // ---------- Public API used by the game ----------

  window.Leaderboard = {
    onGameFinished: function (result) {
      if (!result || result.score <= 0) return;   // nothing worth saving
      openDialog(result);
    },
    isOpen: function () { return open; },
    refresh: refresh
  };

  // ---------- Init ----------

  function init() {
    els = {
      status: $("board-status"),
      table: $("scores-table"),
      body: $("scores-body"),
      empty: $("scores-empty"),
      statGames: $("stat-games"),
      statPlayers: $("stat-players"),
      statBest: $("stat-best"),
      points: $("points-list"),
      modal: $("score-modal"),
      title: $("modal-title"),
      score: $("modal-score"),
      details: $("modal-details"),
      form: $("score-form"),
      input: $("player-name"),
      submit: $("btn-submit"),
      skip: $("btn-skip"),
      message: $("modal-message")
    };

    els.form.addEventListener("submit", submit);
    els.skip.addEventListener("click", closeDialog);
    document.addEventListener("keydown", function (e) {
      if (open && !els.modal.hidden && e.key === "Escape") closeDialog();
    });

    renderPoints();
    refresh();
    setInterval(function () {
      if (!document.hidden) refresh();
    }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
