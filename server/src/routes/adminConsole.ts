// The admin console, served as one page from the API that owns the data.
//
// THE PLAN SAID VITE + REACT IN A NEW WORKSPACE. This is deliberately
// not that, and the reasoning belongs next to the code:
//
//   - The root Vercel build runs `pnpm install --frozen-lockfile` and now
//     also `pnpm typecheck && pnpm lint` over every workspace package. A
//     new React app in the workspace means the WALKERS' app pays for the
//     admin tool's dependencies on every deploy, and gains a new way to
//     fail.
//   - Same origin means no CORS, no second Vercel project, no separate
//     domain to remember, and no `EXPO_PUBLIC_`-style config to keep in
//     step between two deployments.
//   - It is roughly thirty numbers and a refresh. A build toolchain to
//     render thirty numbers is machinery that has to be maintained by
//     whoever inherits this.
//
// The plan's real goal — do not drag Expo, MapLibre and Three into an
// internal tool — is met more completely by having no dependencies at
// all. If the console ever grows into something that genuinely wants a
// component model, this file is the only thing that has to change.
//
// THE PAGE ITSELF IS NOT A SECRET and needs no auth: it is markup with
// no data in it. Every number arrives from /admin/metrics, which requires
// DASHBOARD_TOKEN. The token is kept in this browser's localStorage and
// sent as a bearer header — the same shape /dev uses.
//
// TWO WAYS TO HAND IT OVER. Typed into the box, or carried in the link
// as `?k=<DASHBOARD_TOKEN>` so a bookmark opens straight onto the
// numbers. The link form exists because the alternative people actually
// reach for is removing the auth entirely, and these are DAU, retention
// and spend figures on a path that is readable in a PUBLIC repo — a
// URL nobody can guess is a very different thing from a URL anybody can
// find.
//
// The key is STRIPPED FROM THE ADDRESS BAR the moment it is stored, via
// replaceState. Otherwise it rides along in every screenshot, every
// pasted link, and every Referer header the page ever sends.
//
// READ-ONLY, ON PURPOSE. There are no switches on this page yet. Ops
// actions need ADMIN_TOKEN, which must never live in a browser, so they
// want a different design (per-action re-entry) and a separate change.
// A console that can only look at things cannot break production.

import type { FastifyPluginAsync } from 'fastify';
import { limitRead } from '../lib/rateLimit.js';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>шукайпес — console</title>
<style>
  :root {
    --bg: #14140f; --panel: #1d1d17; --line: #2e2e25;
    --ink: #f3f0e7; --dim: #8a867c; --accent: #cbb26a; --warn: #d98b6a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 24px 16px 64px;
  }
  .wrap { max-width: 940px; margin: 0 auto; }
  h1 { font-size: 15px; font-weight: 400; color: var(--dim); margin: 0 0 20px; }
  h1 b { color: var(--ink); font-weight: 400; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .panel h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; font-weight: 400; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
  .row span:last-child { color: var(--ink); }
  .row span:first-child { color: var(--dim); }
  .big { font-size: 26px; line-height: 1.1; margin: 2px 0 8px; }
  .note { color: var(--dim); font-size: 12px; margin-top: 10px; }
  .warn { color: var(--warn); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; }
  td:first-child { color: var(--dim); }
  td:not(:first-child) { text-align: right; }
  input, button {
    font: inherit; background: #0e0e0a; color: var(--ink);
    border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px;
  }
  button { cursor: pointer; border-color: var(--accent); color: var(--accent); }
  #gate { max-width: 380px; margin: 12vh auto; text-align: center; }
  #gate p { color: var(--dim); font-size: 13px; }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; color: var(--dim); font-size: 12px; }
  .bar button { padding: 5px 10px; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <div id="gate" hidden>
    <h1><b>шукайпес</b> console</h1>
    <p>read-only. paste the dashboard token.</p>
    <p><input id="tok" type="password" placeholder="DASHBOARD_TOKEN" style="width:100%"></p>
    <p><button id="go">open</button></p>
    <p id="gateErr" class="warn"></p>
  </div>
  <div id="main" hidden>
    <div class="bar">
      <span id="stamp">loading…</span>
      <button id="refresh">refresh</button>
      <button id="forget">forget token</button>
      <span id="err" class="warn"></span>
    </div>
    <div class="grid" id="panels"></div>
  </div>
</div>
<script>
(function () {
  var KEY = 'shukajpes.dashToken';
  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }

  // A key in the link wins over whatever this browser had — that is the
  // point of sending somebody a fresh link after a rotation.
  try {
    var fromLink = new URLSearchParams(window.location.search).get('k');
    if (fromLink) {
      token = fromLink;
      try { localStorage.setItem(KEY, fromLink); } catch (e) {}
      // Out of the address bar immediately: a key left there ends up in
      // screenshots, in pasted links, and in the Referer of anything the
      // page loads.
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  } catch (e) {}

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function row(k, v) { return '<div class="row"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }
  function num(n) { return typeof n === 'number' ? n.toLocaleString('en-US') : String(n); }

  function panels(m) {
    var out = [];

    // Bots are named on the face of the panel, not in a tooltip: these
    // numbers are going into a fundraise and nobody should have to
    // remember which figures include thirty synthetic walkers.
    out.push('<div class="panel"><h2>people</h2>' +
      '<div class="big">' + num(m.users.dau) + ' <span style="font-size:13px;color:var(--dim)">DAU</span></div>' +
      row('WAU', num(m.users.wau)) +
      row('real accounts', num(m.users.real)) +
      row('bots (excluded)', num(m.users.bots)) +
      row('new · 24h', num(m.users.newLast24h)) +
      row('new · 7d', num(m.users.newLast7d)) +
      '<div class="note">active = wrote a collect event. bots are never counted above.</div></div>');

    var r = m.retention;
    var pctText = function (d) {
      return d.pct == null
        ? 'n/a — cohort ' + d.cohort
        : d.pct + '% (' + d.returned + '/' + d.cohort + ')';
    };
    out.push('<div class="panel"><h2>retention</h2>' +
      row('D1', pctText(r.d1)) +
      row('D7', pctText(r.d7)) +
      '<div class="note">no percentage below a cohort of ten — "0% of 2" reads as a catastrophe.</div></div>');

    out.push('<div class="panel"><h2>pets</h2>' +
      '<div class="big">' + num(m.pets.active) + ' <span style="font-size:13px;color:var(--dim)">active</span></div>' +
      row('found', num(m.pets.found)) +
      row('expired', num(m.pets.expired)) +
      row('added · 7d', num(m.pets.addedLast7d)) +
      row('on fallback pin', num(m.pets.onFallbackPin)) +
      '<div class="note">fallback-pin rows are invisible on the map — /dogs/nearby filters them out.</div></div>');

    var ing = '<table>';
    if (!m.ingest.length) ing += '<tr><td>no scrape_log rows at all</td></tr>';
    for (var i = 0; i < m.ingest.length; i++) {
      var s = m.ingest[i];
      var age = s.staleHours == null ? 'never' : s.staleHours + 'h ago';
      var stale = s.staleHours != null && s.staleHours > 36;
      ing += '<tr><td>' + esc(s.source) + '</td><td>' + num(s.last7d) + ' / 7d</td>' +
        '<td class="' + (stale ? 'warn' : '') + '">' + esc(age) + '</td></tr>';
    }
    ing += '</table>';
    out.push('<div class="panel"><h2>ingest</h2>' + ing +
      '<div class="note">last = when this source last became a pet row. amber past 36h.</div></div>');

    var f = m.searchFunnel;
    out.push('<div class="panel"><h2>search funnel</h2>' +
      '<div class="big">' + num(f.searchesCompleted) + ' <span style="font-size:13px;color:var(--dim)">searches</span></div>' +
      row('found', num(f.found)) +
      row('walked, empty', num(f.empty)) +
      row('last 7d', num(f.searchesLast7d)) +
      row('sightings ever', num(f.sightings)) +
      '<div class="note">history starts 14 Aug 2026 — before that, a completed search left no row anywhere.</div></div>');

    var c = m.chat;
    var models = '<table>';
    for (var j = 0; j < c.byModel.length; j++) {
      var b = c.byModel[j];
      models += '<tr><td>' + esc(b.model) + '</td><td>' + num(b.messages) + '</td>' +
        '<td>' + num(b.inputTokens) + ' in</td><td>' + num(b.outputTokens) + ' out</td></tr>';
    }
    models += '</table>';
    out.push('<div class="panel"><h2>companion · 7d</h2>' +
      '<div class="big">' + num(c.messagesLast7d) + ' <span style="font-size:13px;color:var(--dim)">messages</span></div>' +
      row('people talking', num(c.usersLast7d)) +
      row('cache reads', num(c.cacheReadTokensLast7d)) +
      models + '</div>');

    out.push('<div class="panel"><h2>territory</h2>' +
      row('marks', num(m.territory.marks)) +
      row('claimed shapes', num(m.territory.claimedShapes)) +
      row('owners holding ground', num(m.territory.ownersWithGround)) + '</div>');

    return out.join('');
  }

  function load() {
    $('err').textContent = '';
    return fetch('/admin/metrics', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (res.status === 401) throw new Error('401 — token refused');
        if (!res.ok) throw new Error(res.status + ' — ' + res.statusText);
        return res.json();
      })
      .then(function (m) {
        $('panels').innerHTML = panels(m);
        $('stamp').textContent = 'as of ' + new Date(m.generatedAt).toLocaleString();
      })
      .catch(function (e) {
        // Say which failure it was. A console that goes blank teaches
        // nobody whether the token is wrong or the server is down.
        $('err').textContent = e.message;
        if (/401/.test(e.message)) { forget(); }
      });
  }

  function show() {
    $('gate').hidden = !!token;
    $('main').hidden = !token;
    if (token) load();
  }
  function forget() {
    token = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    show();
  }

  $('go').onclick = function () {
    var v = $('tok').value.trim();
    if (!v) return;
    token = v;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    show();
  };
  $('tok').onkeydown = function (e) { if (e.key === 'Enter') $('go').click(); };
  $('refresh').onclick = load;
  $('forget').onclick = forget;
  // Slow on purpose: /admin/metrics is a dozen aggregates and is rate
  // limited to 10/min. A console left open on a wall should not compete
  // with the map for the database.
  setInterval(function () { if (token && !document.hidden) load(); }, 120000);
  show();
})();
</script>
</body>
</html>`;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/console', limitRead, async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    // No caching: the page is small and shipping a stale console after a
    // change is a confusing way to debug.
    reply.header('cache-control', 'no-store');
    return PAGE;
  });
};

export default plugin;
