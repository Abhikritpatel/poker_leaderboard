// ==========================================================================
// Poker Tracker
// ==========================================================================

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleCase = s => String(s).replace(/\b\w/g, c => c.toUpperCase());
const grouped = n => Math.abs(Math.round(n)).toLocaleString('en-IN');
const signed = n => (n < 0 ? '−' : n > 0 ? '+' : '') + '₹' + grouped(n);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- 1. State & persistence ---
const state = {
    groupId: 'main', groups: [], isAdmin: false,
    range: 'all', custom: null, view: 'standings',
    reqId: 0, flip: true,
};
try { state.flip = localStorage.getItem('poker_flip') !== 'off'; } catch (e) { /* storage unavailable */ }

function getAdminPin(groupId) {
    try { return JSON.parse(localStorage.getItem('poker_admin_keys') || '{}')[groupId] || null; }
    catch (e) { return null; }
}
function setAdminPin(groupId, pin) {
    try {
        const keys = JSON.parse(localStorage.getItem('poker_admin_keys') || '{}');
        keys[groupId] = String(pin).trim();
        localStorage.setItem('poker_admin_keys', JSON.stringify(keys));
    } catch (e) { console.error('Error saving admin key:', e); }
}

// The table comes from ?table=. An invite key travels in the #key= fragment so
// it is never sent to the server; it is stored, then stripped from the URL.
const tableFromUrl = new URLSearchParams(location.search).get('table');
const keyFromUrl = new URLSearchParams(location.hash.slice(1)).get('key');
try {
    const stored = localStorage.getItem('poker_active_table');
    if (tableFromUrl) state.groupId = tableFromUrl;
    else if (stored) state.groupId = stored;
} catch (e) { if (tableFromUrl) state.groupId = tableFromUrl; }
if (keyFromUrl) {
    setAdminPin(state.groupId, keyFromUrl);
    history.replaceState(null, '', `${location.pathname}?table=${encodeURIComponent(state.groupId)}`);
}

async function api(url, opts) {
    try {
        const res = await fetch(url, opts);
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON body */ }
        return { ok: res.ok, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: null };
    }
}
const postJSON = (url, body, headers = {}) => api(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

let toastTimer;
function toast(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
        ta.remove();
        return ok;
    }
}
function flashLabel(btn, text, original) {
    btn.textContent = text; setTimeout(() => { btn.textContent = original; }, 1800);
}

// --- 2. Flip tiles ---
const DIGITS = '0123456789';
const FLIP = [{ transform: 'rotateX(-88deg)', filter: 'brightness(.45)' }, { transform: 'rotateX(0)', filter: 'brightness(1)' }];

function flipTo(tile, ch, delay) {
    if (tile.textContent === ch) return;
    clearTimeout(tile._tm);
    if (reducedMotion) { tile.textContent = ch; return; }
    let steps = 3 + Math.floor(Math.random() * 3);
    const step = () => {
        if (steps-- <= 0) { tile.textContent = ch; tile.animate(FLIP, { duration: 120 }); return; }
        tile.textContent = DIGITS[Math.floor(Math.random() * 10)];
        tile.animate(FLIP, { duration: 70 });
        tile._tm = setTimeout(step, 70);
    };
    tile._tm = setTimeout(step, delay);
}

// Renders a number into host as flip tiles, or as plain text when o.plain is set
// (standings) or the flip preference is off. Only the live session uses tiles.
function num(host, text, o = {}) {
    if (!text) { host.innerHTML = ''; return; }
    if (o.plain || !state.flip) {
        const shown = esc(text).replace(/^([+−-])/, '<span class="sg">$1</span>');
        host.innerHTML = `<span class="plain ${o.cls || ''} ${o.felt ? 'onfelt' : ''}" style="font-size:${o.plainSize || '1.5rem'}">${shown}</span>`;
        return;
    }
    let flap = host.firstElementChild;
    if (!flap || !flap.classList.contains('flap')) { host.innerHTML = '<span class="flap"></span>'; flap = host.firstElementChild; }
    flap.className = `flap ${o.cls || ''} ${o.size || ''} ${o.tiles || ''}`;
    const chars = [...text];
    while (flap.children.length < chars.length) {
        const t = document.createElement('span'); t.className = 'tile'; t.textContent = ' ';
        flap.insertBefore(t, flap.firstChild);
    }
    while (flap.children.length > chars.length) flap.removeChild(flap.firstChild);
    chars.forEach((ch, i) => {
        const t = flap.children[i];
        t.className = 'tile' + (ch === ',' || ch === '.' ? ' p' : '') + (ch === '+' || ch === '−' || ch === '-' ? ' sign' : '');
        flipTo(t, ch, (chars.length - i) * 30);
    });
}
const tone = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

// --- 3. Tables (the hand of cards) ---
const SUITS = ['♠', '♥', '♦', '♣'];
function suitFor(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return SUITS[h % 4];
}
const currentGroup = () => state.groups.find(g => g.group_id === state.groupId);
const currentName = () => (currentGroup() ? currentGroup().name : 'Poker');

function renderHand() {
    $('hand').innerHTML = state.groups.map(g => {
        const suit = suitFor(g.group_id);
        return `<button class="card ${suit === '♥' || suit === '♦' ? 'red' : ''}" data-id="${esc(g.group_id)}" ${g.group_id === state.groupId ? 'aria-current="true"' : ''}>
            <span class="s">${suit}</span><span class="wm">${suit}</span><span class="nm">${esc(g.name)}</span></button>`;
    }).join('') + '<button class="card new" data-open="dlg-new">+ new table</button>';

    const name = currentName(), parts = name.trim().split(/\s+/);
    $('table_title').innerHTML = parts.length > 1 ? `${esc(parts[0])} <em>${esc(parts.slice(1).join(' '))}</em>` : esc(name);
    document.title = `${name} · Poker Tracker`;
    $('unlock_name').textContent = name;
    const hand = $('hand'), active = hand.querySelector('[aria-current="true"]');
    if (active) hand.scrollLeft = active.offsetLeft - (hand.clientWidth - active.offsetWidth) / 2;
}

async function selectGroup(id) {
    if (id === state.groupId) return;
    state.groupId = id;
    try { localStorage.setItem('poker_active_table', id); } catch (e) { /* ignore */ }
    history.replaceState(null, '', `?table=${encodeURIComponent(id)}`);
    renderHand();
    setView('standings');
    resetSession();
    await Promise.all([checkAdmin(), refreshBoard(), refreshSummary()]);
}

async function loadGroups() {
    const r = await api('/api/groups');
    state.groups = r.ok && Array.isArray(r.data) ? r.data : [];
    if (state.groups.length && !currentGroup()) state.groupId = state.groups[0].group_id;
    renderHand();
    await Promise.all([checkAdmin(), refreshBoard(), refreshSummary()]);
}

// --- 4. Admin / roles ---
function setAdmin(isAdmin) {
    state.isAdmin = isAdmin;
    document.body.dataset.role = isAdmin ? 'dealer' : 'viewer';
    if (!isAdmin && state.view === 'session') setView('standings');
    if (state.lastBoard && !state.lastBoard.length) renderBoard(state.lastBoard);
}

async function checkAdmin() {
    const id = state.groupId, pin = getAdminPin(id);
    let ok = false;
    if (pin) {
        const r = await postJSON('/api/groups/verify_admin', { group_id: id, pin });
        ok = !!(r.data && r.data.status === 'success' && r.data.is_admin);
    }
    if (id === state.groupId) setAdmin(ok);
    return ok;
}

// --- 5. Standings ---
function leaderboardUrl() {
    const p = new URLSearchParams({ group_id: state.groupId });
    if (state.range === 'custom' && state.custom) {
        p.set('timeframe', 'custom'); p.set('start', state.custom.start); p.set('end', state.custom.end);
    } else {
        p.set('timeframe', state.range === 'custom' ? 'all' : state.range);
    }
    return `/api/leaderboard?${p}`;
}
const prettyDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const rangeLabel = () => ({
    all: 'all time', month: 'over the last 30 days', week: 'over the last 7 days',
    custom: state.custom ? `from ${prettyDate(state.custom.start)} to ${prettyDate(state.custom.end)}` : 'all time',
}[state.range]);

function sparkline(series) {
    if (!series || series.length < 2) return '<span class="spark"></span>';
    const MAX = 24;
    let pts = [0, ...series];
    if (pts.length > MAX) pts = pts.filter((_, i) => i === pts.length - 1 || i % Math.ceil(pts.length / MAX) === 0);
    const w = 118, h = 34, lo = Math.min(...pts, 0), hi = Math.max(...pts, 0), span = (hi - lo) || 1;
    const y = v => (h - 3 - (v - lo) / span * (h - 6)).toFixed(1);
    const line = pts.map((v, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${y(v)}`).join(' ');
    const colour = series[series.length - 1] < 0 ? '#b3262e' : '#2b6b45';
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(26,22,15,.25)" stroke-dasharray="2 3"/><polyline fill="none" stroke="${colour}" stroke-width="1.8" stroke-linejoin="round" points="${line}"/></svg>`;
}

function renderLoading() {
    $('board').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
}

function renderLede(data) {
    const el = $('lede');
    if (!data.length) {
        el.textContent = state.range === 'all' ? 'No games logged yet.' : 'No games in this range.';
        if (state.range === 'all' && state.isAdmin) el.textContent += ' Deal the first session to get the board moving.';
        return;
    }
    if (data.length === 1) { el.textContent = `${titleCase(data[0].name)} is the only one on the board so far.`; return; }
    const top = data[0], last = data[data.length - 1];
    const money = v => signed(v).replace('₹', '⁠₹');
    el.textContent = `${titleCase(top.name)} leads ${rangeLabel()} at ${money(top.total_winning)}. ${titleCase(last.name)} trails at ${money(last.total_winning)}.`;
}

function renderBoard(data) {
    state.lastBoard = data;
    renderLede(data);
    const panel = $('board');
    $('board_note').textContent = data.length ? 'Every row nets against the others, so the whole board sums to zero.' : '';
    if (!data.length) {
        const cta = state.isAdmin
            ? '<button class="btn-gold" id="empty_cta">Deal a session</button>'
            : '<p>Ask the dealer to log the first night.</p>';
        panel.innerHTML = `<div class="empty"><h3>The felt is empty</h3><p>No games logged for <b>${esc(currentName())}</b>${state.range === 'all' ? ' yet' : ' in this range'}.</p>${cta}</div>`;
        const btn = $('empty_cta'); if (btn) btn.onclick = () => setView('session');
        return;
    }
    panel.innerHTML = data.map((p, i) => `
        <div class="lrow ${i === 0 ? 'first' : ''}" style="animation-delay:${Math.min(i, 8) * 50}ms">
            <div class="chip ${i < 3 ? 'c' + (i + 1) : 'cn'}">${i + 1}</div>
            <div class="lname">${esc(titleCase(p.name))}${i === 0 ? '<span class="tag">Leader</span>' : ''}<small>${p.nights} ${p.nights === 1 ? 'night' : 'nights'}</small></div>
            ${sparkline(p.series)}
            <div class="lamt"></div>
        </div>`).join('');
    [...panel.querySelectorAll('.lamt')].forEach((el, i) => {
        const v = data[i].total_winning;
        num(el, signed(v), { cls: tone(v), plain: true, plainSize: i === 0 ? '1.9rem' : '1.45rem' });
    });
}

async function refreshBoard() {
    const id = ++state.reqId;
    renderLoading();
    const r = await api(leaderboardUrl());
    if (id !== state.reqId) return;
    if (!r.ok || !Array.isArray(r.data)) {
        $('board').innerHTML = '<div class="empty"><h3>Couldn\'t load the standings</h3><p>Check your connection and try again.</p><button class="btn-gold" id="retry">Retry</button></div>';
        $('retry').onclick = refreshBoard;
        return;
    }
    renderBoard(r.data);
}

async function refreshSummary() {
    const id = state.groupId;
    const r = await api(`/api/table_summary?group_id=${encodeURIComponent(id)}`);
    if (id !== state.groupId) return;
    const s = r.ok && r.data ? r.data : null;
    $('st_nights').textContent = s ? s.nights : '–';
    $('st_pot').textContent = s ? '₹' + grouped(s.biggest_pot) : '–';
    $('st_players').textContent = s ? s.players : '–';
    const log = $('log');
    if (!s || !s.recent.length) { log.innerHTML = '<div><span class="none">No nights logged yet.</span></div>'; return; }
    log.innerHTML = s.recent.map(n => {
        const d = new Date(n.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return `<div><span>${esc(d)}<small>${n.players} players · ₹${grouped(n.pot)} pot</small></span><b>${esc(titleCase(n.top_name || ''))}<br>${signed(n.top_profit)}</b></div>`;
    }).join('');
}

// Range controls
$('ranges').addEventListener('click', e => {
    const r = e.target.dataset.r; if (!r) return;
    [...$('ranges').children].forEach(b => b.setAttribute('aria-pressed', b === e.target));
    $('custom_range').hidden = r !== 'custom';
    if (r === 'custom') {
        if (state.custom) { $('start_date').value = state.custom.start; $('end_date').value = state.custom.end; }
        $('start_date').focus();
        return;
    }
    state.range = r; refreshBoard();
});
$('custom_range').addEventListener('submit', e => {
    e.preventDefault();
    const start = $('start_date').value, end = $('end_date').value;
    if (!start || !end) { toast('Pick both a start and an end date.', true); return; }
    if (start > end) { toast('The start date must be before the end date.', true); return; }
    state.custom = { start, end }; state.range = 'custom'; refreshBoard();
});

// --- 6. Live session ---
const blankSeat = () => ({ name: '', buyIns: 1, chips: '' });
let seats = [blankSeat(), blankSeat()];
let lastRows = [], lastPay = [], lastCalc = null, saved = false;

function renderSeats() {
    $('seats').innerHTML = seats.map((s, i) => `
        <div class="seat" data-i="${i}">
            <span class="n">${i + 1}</span>
            <input class="pn" value="${esc(s.name)}" placeholder="Name" maxlength="100" data-f="name" aria-label="Player ${i + 1} name" autocomplete="off">
            <div class="step"><button type="button" data-d="-1" aria-label="Fewer buy-ins">−</button><output>${s.buyIns}</output><button type="button" data-d="1" aria-label="More buy-ins">+</button></div>
            <input type="number" inputmode="decimal" min="0" step="any" value="${esc(s.chips)}" placeholder="End chips" data-f="chips" aria-label="End chips for player ${i + 1}">
            <div class="res"></div>
            <button type="button" class="rm" data-rm aria-label="Remove player ${i + 1}">×</button>
        </div>`).join('');
    calc();
}

function settle(rows) {
    const debtors = rows.filter(r => r.net < -0.005).map(r => [r.name, -r.net]).sort((a, b) => b[1] - a[1]);
    const creditors = rows.filter(r => r.net > 0.005).map(r => [r.name, r.net]).sort((a, b) => b[1] - a[1]);
    const out = []; let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const x = Math.min(debtors[i][1], creditors[j][1]);
        out.push([debtors[i][0], creditors[j][0], x]);
        debtors[i][1] -= x; creditors[j][1] -= x;
        if (debtors[i][1] < 0.005) i++;
        if (creditors[j][1] < 0.005) j++;
    }
    return out;
}

function calc() {
    const ratio = parseFloat($('chip_ratio').value) || 5;
    const buyin = parseFloat($('buy_in_amt').value) || 100;
    let sum = 0, buyIns = 0;
    const rows = [];
    seats.forEach((s, i) => {
        const name = s.name.trim(); if (!name) return;
        const net = (parseFloat(s.chips) || 0) / ratio - buyin * s.buyIns;
        sum += net; buyIns += s.buyIns; rows.push({ name, net, i });
    });
    const off = Math.round(sum * 100) / 100;
    const balanced = rows.length >= 2 && off === 0;
    lastRows = rows; lastCalc = { ratio, buyin, buyIns, off, balanced };

    [...$('seats').children].forEach((el, i) => {
        const row = rows.find(r => r.i === i);
        num(el.querySelector('.res'), row ? signed(row.net) : '', { cls: row ? tone(row.net) : '', size: 'sm', plainSize: '1.2rem' });
    });
    num($('f_pot'), '₹' + grouped(buyIns * buyin), { size: 'xl', tiles: 'card-tiles', felt: true, plainSize: '2.7rem' });
    num($('f_chips'), grouped(buyIns * buyin * ratio), { tiles: 'card-tiles', felt: true, plainSize: '1.7rem' });
    $('pot_sub').textContent = `${buyIns} ${buyIns === 1 ? 'buy-in' : 'buy-ins'} at ₹${grouped(buyin)}`;
    $('stack').innerHTML = '<i></i>'.repeat(Math.min(buyIns, 10));

    const msg = $('msg'), save = $('save_game');
    if (saved) {
        msg.className = 'msg ok'; msg.innerHTML = 'Saved to the books<small>Copy the recap below for the group.</small>';
        save.disabled = true; save.textContent = 'Saved ✓';
    } else if (rows.length < 2) {
        msg.className = 'msg idle'; msg.innerHTML = 'Seat at least two players<small>Add names and end chips to check the table.</small>';
        save.disabled = true; save.textContent = 'Lock it in';
    } else if (!balanced) {
        msg.className = 'msg';
        msg.innerHTML = `${off > 0 ? 'Over by ' : 'Short by '}${grouped(off * ratio)} chips<small>That is ₹${grouped(off)} that does not exist. Recount the stacks.</small>`;
        save.disabled = true; save.textContent = 'Lock it in';
    } else {
        msg.className = 'msg ok'; msg.innerHTML = 'The table is square<small>Every chip is accounted for.</small>';
        save.disabled = false; save.textContent = 'Lock it in';
    }

    lastPay = balanced ? settle(rows) : [];
    const box = $('payments');
    if (!balanced) {
        box.innerHTML = '<p class="hint">Square the table first and the settle-up slips appear.</p>';
    } else if (!lastPay.length) {
        box.innerHTML = '<p class="hint">Nobody owes anything tonight.</p>';
    } else {
        box.innerHTML = lastPay.map(([a, b], i) => `<div class="slip" style="animation-delay:${i * 70}ms"><b>${esc(a)}</b><span class="arrow">pays</span><b>${esc(b)}</b><span class="amt"></span></div>`).join('');
        [...box.querySelectorAll('.amt')].forEach((el, i) => num(el, '₹' + grouped(lastPay[i][2]), { size: 'sm', tiles: 'card-tiles', plainSize: '1.2rem' }));
    }
    renderRecap();
}

function recapText() {
    if (!lastCalc || !lastCalc.balanced) return '';
    const d = new Date($('game_date').value + 'T00:00:00');
    const when = isNaN(d) ? '' : ' · ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const chips = n => (n < 0 ? '-' : n > 0 ? '+' : '') + grouped(n * lastCalc.ratio) + ' chips';
    const lines = [`${currentName()}${when}`, `Pot ₹${grouped(lastCalc.buyIns * lastCalc.buyin)} · ${lastCalc.buyIns} buy-ins`, ''];
    [...lastRows].sort((a, b) => b.net - a.net).forEach(r => lines.push(`${titleCase(r.name)}: ${chips(r.net)}`));
    if ($('inc_settle').checked && lastPay.length) {
        lines.push('', 'Settle up:');
        lastPay.forEach(([a, b, x]) => lines.push(`${titleCase(a)} → ${titleCase(b)} ₹${grouped(x)}`));
    }
    return lines.join('\n');
}

function renderRecap() {
    const text = recapText(), bubble = $('bubble');
    bubble.className = 'bubble' + (text ? '' : ' empty');
    bubble.textContent = text || 'Square the table first. The recap only appears once every chip is accounted for.';
    $('copy_recap').disabled = !text;
    $('share_recap').hidden = !(text && navigator.share);
}

function resetSession() {
    seats = [blankSeat(), blankSeat()]; saved = false;
    $('seats_panel').inert = false; document.querySelector('.conf').inert = false;
    $('saved_actions').hidden = true;
    $('game_date').value = today();
    renderSeats();
}

$('seats').addEventListener('click', e => {
    const row = e.target.closest('.seat'); if (!row) return;
    const i = +row.dataset.i;
    if (e.target.dataset.d) {
        seats[i].buyIns = Math.max(1, seats[i].buyIns + +e.target.dataset.d);
        row.querySelector('output').textContent = seats[i].buyIns; calc();
    } else if (e.target.dataset.rm !== undefined) {
        seats.splice(i, 1); renderSeats();
    }
});
$('seats').addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f) return;
    seats[+e.target.closest('.seat').dataset.i][f] = e.target.value; calc();
});
['chip_ratio', 'buy_in_amt', 'game_date'].forEach(id => $(id).addEventListener('input', calc));
$('inc_settle').addEventListener('change', renderRecap);
$('add_player').addEventListener('click', () => {
    seats.push(blankSeat()); renderSeats();
    const inputs = $('seats').querySelectorAll('.pn'); inputs[inputs.length - 1].focus();
});

$('copy_recap').addEventListener('click', async () => {
    const ok = await copyText(recapText());
    if (ok) flashLabel($('copy_recap'), 'Copied ✓', 'Copy message'); else toast('Couldn\'t copy. Select the text and copy it by hand.', true);
});
$('share_recap').addEventListener('click', () => { navigator.share({ text: recapText() }).catch(() => {}); });

$('save_game').addEventListener('click', async () => {
    if (!state.isAdmin) { $('dlg-unlock').showModal(); return; }
    const btn = $('save_game');
    const payload = {
        group_id: state.groupId,
        date: $('game_date').value,
        chip_ratio: lastCalc.ratio,
        buy_in_amt: lastCalc.buyin,
        transactions: lastRows.map(r => ({ name: r.name, buy_ins: seats[r.i].buyIns, end_chips: parseFloat(seats[r.i].chips) || 0 })),
    };
    btn.disabled = true; btn.textContent = 'Saving…';
    const r = await postJSON('/api/add_game', payload, { 'X-Admin-Key': getAdminPin(state.groupId) || '' });
    if (r.data && r.data.status === 'success') {
        saved = true;
        $('seats_panel').inert = true; document.querySelector('.conf').inert = true;
        $('saved_actions').hidden = false;
        calc(); toast('Game saved.');
        refreshBoard(); refreshSummary();
    } else {
        const message = (r.data && r.data.message) || 'Couldn\'t reach the server. Nothing was saved.';
        toast(message, true);
        if (r.status === 403) checkAdmin();
        calc();
    }
});
$('back_to_board').addEventListener('click', () => { resetSession(); setView('standings'); });

// --- 7. Views ---
function setView(v) {
    state.view = v; document.body.dataset.view = v;
    $('standings').hidden = v !== 'standings'; $('session').hidden = v !== 'session';
    $('v_stand').setAttribute('aria-pressed', v === 'standings'); $('v_sess').setAttribute('aria-pressed', v === 'session');
    $('ranges').style.visibility = v === 'standings' ? 'visible' : 'hidden';
    if (v !== 'standings') $('custom_range').hidden = true;
    else if (state.range === 'custom') $('custom_range').hidden = false;
    if (v === 'session') { if (!$('game_date').value) $('game_date').value = today(); renderSeats(); }
}
$('v_stand').addEventListener('click', () => setView('standings'));
const openSession = () => (state.isAdmin ? setView('session') : $('dlg-unlock').showModal());
$('v_sess').addEventListener('click', openSession);
$('dock_deal').addEventListener('click', openSession);

// --- 8. Dialogs ---
function openShare(title) {
    const pin = getAdminPin(state.groupId);
    if (!pin) return;
    $('share_title').textContent = title || 'Share the deal';
    $('share_name').textContent = currentName();
    $('pinchips').innerHTML = [...pin].map((c, i) => `<div class="chip ${['c1', 'c2', 'c3', '', 'c1', 'c2'][i % 6]}">${esc(c)}</div>`).join('');
    $('share_link').innerHTML = `${esc(location.origin)}/?table=${esc(encodeURIComponent(state.groupId))}<b style="color:var(--red)">#key=${esc(encodeURIComponent(pin))}</b>`;
    $('dlg-share').showModal();
}
const inviteLink = () => `${location.origin}/?table=${encodeURIComponent(state.groupId)}#key=${encodeURIComponent(getAdminPin(state.groupId) || '')}`;

document.addEventListener('click', e => {
    const card = e.target.closest('.card[data-id]');
    if (card) { selectGroup(card.dataset.id); return; }
    const opener = e.target.closest('[data-open]');
    if (opener) {
        const id = opener.dataset.open;
        if (id === 'dlg-share') openShare(); else $(id).showModal();
        return;
    }
    if (e.target.tagName === 'DIALOG') e.target.close();
});
const onDialogClose = {
    'dlg-unlock': () => { $('pin').value = ''; $('unlock_err').textContent = ''; },
    'dlg-new': () => { $('new_err').textContent = ''; },
};
document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => { if (onDialogClose[d.id]) onDialogClose[d.id](); }));

$('flip_toggle').addEventListener('click', () => {
    state.flip = !state.flip;
    try { localStorage.setItem('poker_flip', state.flip ? 'on' : 'off'); } catch (e) { /* ignore */ }
    $('flip_toggle').textContent = `Flip digits: ${state.flip ? 'on' : 'off'}`;
    $('flip_toggle').setAttribute('aria-pressed', state.flip);
    document.querySelectorAll('.res, .amt, #f_pot, #f_chips').forEach(el => { el.innerHTML = ''; });
    calc();
});

async function submitUnlock() {
    const pin = $('pin').value.trim(), err = $('unlock_err'), btn = $('unlock_go');
    if (!pin) { err.textContent = 'Enter the dealer PIN.'; return; }
    btn.disabled = true;
    const r = await postJSON('/api/groups/verify_admin', { group_id: state.groupId, pin });
    btn.disabled = false;
    if (r.data && r.data.status === 'success' && r.data.is_admin) {
        setAdminPin(state.groupId, pin); setAdmin(true);
        $('dlg-unlock').close(); toast(`You're dealing ${currentName()}.`);
    } else {
        err.textContent = r.status === 0 ? 'Couldn\'t reach the server. Try again.' : 'That\'s not the dealer PIN. Ask whoever opened the table.';
        const f = $('f_unlock'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
    }
}
$('unlock_go').addEventListener('click', submitUnlock);
$('pin').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitUnlock(); } });

async function submitNewTable() {
    const name = $('new_name').value.trim(), pin = $('new_pin').value.trim(), err = $('new_err'), btn = $('new_go');
    if (!name) { err.textContent = 'Give the table a name.'; $('new_name').focus(); return; }
    btn.disabled = true;
    const r = await postJSON('/api/groups', { name, pin });
    btn.disabled = false;
    if (!r.data || r.data.status !== 'success') {
        err.textContent = (r.data && r.data.message) || 'Couldn\'t open the table. Try again.';
        return;
    }
    setAdminPin(r.data.group_id, r.data.admin_pin);
    state.groupId = r.data.group_id;
    try { localStorage.setItem('poker_active_table', state.groupId); } catch (e) { /* ignore */ }
    history.replaceState(null, '', `?table=${encodeURIComponent(state.groupId)}`);
    $('new_name').value = ''; $('new_pin').value = '';
    $('dlg-new').close();
    resetSession(); setView('standings');
    await loadGroups();
    openShare('Table open. Keep this PIN.');
}
$('new_go').addEventListener('click', submitNewTable);
['new_name', 'new_pin'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitNewTable(); } }));

$('copy_pin').addEventListener('click', async () => {
    if (await copyText(getAdminPin(state.groupId) || '')) flashLabel($('copy_pin'), 'Copied ✓', 'Copy PIN');
});
$('copy_link').addEventListener('click', async () => {
    if (await copyText(inviteLink())) flashLabel($('copy_link'), 'Copied ✓', 'Copy link');
});

// --- 9. Initial page setup ---
$('flip_toggle').textContent = `Flip digits: ${state.flip ? 'on' : 'off'}`;
$('flip_toggle').setAttribute('aria-pressed', state.flip);
$('game_date').value = today();
setView('standings');
loadGroups();
