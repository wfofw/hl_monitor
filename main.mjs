// Hyperliquid real-time monitor: aggregates positions by address/coin,
// calculates open/close (VWAP), displays a live table, and dumps closed positions every 30 minutes.
// Requires Node 21+ (global fetch and WebSocket).

// ╔════════════════════════════════════════════════════════════════════════╗
// ║                  Hyperliquid Perp Realtime Monitor v1.0                ║
// ║════════════════════════════════════════════════════════════════════════║
// ║  Usage:                                                                ║
// ║     node main.mjs [--threshold] [--coins] [--from] [--print-trades]    ║
// ║                   [--table-sec <sec>] [--dump-after]                   ║
// ║  Main flags:                                                           ║
// ║     --threshold <USD>     minimum transaction size for tracking        ║
// ║     --coins BTC,ETH,...   Specify specific coins (default: all)        ║
// ║     --from <data/ts>      pull up recentTrades history from this date  ║
// ║     --print-trades        display all major transactions in the console║
// ║     --table-sec <sec>     table update frequency (default 5)           ║
// ║     --dump-after <N>      dump after N closed positions (default 10)   ║
// ║  Examples:                                                             ║
// ║     --> node main_v2.mjs                                               ║
// ║          (All coins, threshold $50k, table every 5 seconds)            ║
// ║                                                                        ║
// ║     --> node main_v2.mjs --coins BTC,ETH --threshold 100000            ║
// ║          (Track only BTC and ETH, trades over $100k)                   ║
// ║                                                                        ║
// ║     --> node main_v2.mjs --print-trades --dump-after 5                 ║
// ║          (Show all trades, dump after 5 closed positions)              ║
// ╚════════════════════════════════════════════════════════════════════════╝

import fs from 'fs';
const EPS = 1e-9;
const isZero = (x) => Math.abs(x) < EPS;

// file logging (enable with --log-file)
const ARGV = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.startsWith('--') ? s.slice(2).split('=') : [s, true];
  return [k, v ?? true];
}));
const logFile = ARGV['log-file'] ? `./logs/perp_${new Date().toISOString().replace(/[-:]/g,'').slice(0,15)}.log` : null;
if (logFile) fs.mkdirSync('./logs', { recursive: true });
const logStream = logFile ? fs.createWriteStream(logFile, { flags:'a' }) : null;
function logLine(obj) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, ...obj });
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

const INFO_URL = 'https://api.hyperliquid.xyz/info';
const WS_URL   = 'wss://api.hyperliquid.xyz/ws';

let ws = null;
let lastMsgTs = Date.now();
let reconnectAttempt = 0;
const MAX_BACKOFF = 60_000; // 60s

function connectWS(coins, onTrade) {
  if (typeof WebSocket === 'undefined') throw new Error('Node 21+ required');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    reconnectAttempt = 0;
    console.log('WS enabled');
    for (const coin of coins) {
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin } }));
    }
    console.log(`Subscriptions sent (${coins.length})`);
  };

  ws.onmessage = (ev) => {
    lastMsgTs = Date.now();
    try {
      const msg = JSON.parse(ev.data);
      if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return;
      for (const tr of msg.data) onTrade(tr);
    } catch (e) {
      console.warn('WS parse:', e.message);
    }
  };

  ws.onerror = (e) => console.error('WS error:', e?.message ?? e);

  ws.onclose = () => {
    console.warn('WS close');
    scheduleReconnect(coins, onTrade);
  };
}

function scheduleReconnect(coins, onTrade) {
  reconnectAttempt++;
  const delay = Math.min(1000 * (2 ** reconnectAttempt), MAX_BACKOFF);
  console.log(`Reconnection in ${Math.round(delay/1000)}s...`);
  setTimeout(() => connectWS(coins, onTrade), delay);
}

// watchdog: if no messages > 60s - close the socket, it will reconnect automatically
setInterval(() => {
  if (!ws) return;
  if (Date.now() - lastMsgTs > 60_000) {
    console.warn('WS no messages >60s, restarting...');
    try { ws.close(); } catch {}
  }
}, 15_000);


// ---------- utilities ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const shortAddr = (a) => a ? (a) : 'unknown';
const now = () => Date.now();

function fmtUSD(n) {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  if (abs >= 1e9)  return '$' + (n/1e9).toFixed(2) + 'B';
  if (abs >= 1e6)  return '$' + (n/1e6).toFixed(2) + 'M';
  if (abs >= 1e3)  return '$' + (n/1e3).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
}
function fmtTS(ms) { return new Date(ms).toISOString().replace('T',' ').split('.')[0]; }

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function currentOpenNotional(pos) {
  if (!Number.isFinite(pos.size) || !Number.isFinite(pos.avgOpenPrice)) return 0;
  return pos.size * pos.avgOpenPrice;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    threshold: 50_000, // alert threshold for individual trades (the aggregator takes all trades into account)
    from: null, // thin backmatch (recentTrades), if there are users (not always)
    coins: null, // CSV
    dumpEveryMin: 30, // closed position dump period
    tableEverySec: 5, // table update period
    printTrades: false // print "events" for trades above the table
  };

  out.dumpAfter = 10; // default

  for (let i = 0; i < args.length; i++) {
    const k = args[i], v = args[i+1];
    if (k === '--threshold' && v) { out.threshold = Number(v); i++; }
    else if (k === '--from' && v)  {
      const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
      if (!Number.isFinite(t)) throw new Error('Wrong --from');
      out.from = t; i++;
    }
    else if (k === '--coins' && v) { out.coins = v.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean); i++; }
    else if (k === '--dump-min' && v) { out.dumpEveryMin = Number(v); i++; }
    else if (k === '--table-sec' && v) { out.tableEverySec = Number(v); i++; }
    else if (k === '--print-trades') { out.printTrades = true; }
    else if (k === '--dump-after' && v) { out.dumpAfter = Math.max(1, Number(v)); i++; }
  }
  return out;
}

let CONFIG = {
    dumpAfter: 10,
    threshold: 50000
};

let closedSinceDump = 0;
const closedCountByAddress = new Map();

function finalizePosition(p) {
  const firstTs = p.firstTs ?? p.openTime;
  const lastTs = p.lastTs ?? p.closeTime ?? p.lastUpdate ?? Date.now();
  const durationMs = lastTs - firstTs;
  const avgOpen = p.openSzAccum > 0 ? (p.openNotional / p.openSzAccum) : 0;
  const avgClose = p.closeSzAccum > 0 ? (p.closeNotional / p.closeSzAccum) : 0;
  const direction = p.lastDir || p.initDir || p.direction || 'LONG';
  const pnlUsd = direction === 'SHORT'
    ? (p.openNotional - p.closeNotional)
    : (p.closeNotional - p.openNotional);

  const closed = {
    address: p.address,
    coin: p.coin,
    direction,
    size: 0,
    openNotional: p.openNotional,
    openSzAccum: p.openSzAccum,
    avgOpenPrice: avgOpen,
    closeNotional: p.closeNotional,
    closeSzAccum: p.closeSzAccum,
    avgClosePrice: avgClose,
    openTime: firstTs,
    openTimeIso: fmtTS(firstTs),
    lastUpdate: lastTs,
    lastUpdateIso: fmtTS(lastTs),
    closeTime: lastTs,
    closeTimeIso: fmtTS(lastTs),
    status: 'CLOSED',
    durationMs,
    pnlUsd
  };
  closedPositions.push(closed);
  logLine({
    type: 'close',
    address: p.address,
    coin: p.coin,
    pnlUsd: +pnlUsd.toFixed(2),
    openSz: +p.openSzAccum.toFixed(8),
    closeSz: +p.closeSzAccum.toFixed(8),
    holdSec: Math.round(durationMs/1000),
    openTimeIso: closed.openTimeIso,
    closeTimeIso: closed.closeTimeIso
  });
}

function pushClosed(pos) {
  closedPositions.push(pos);
  closedSinceDump++;

  const prev = closedCountByAddress.get(pos.address) || 0;
  closedCountByAddress.set(pos.address, prev + 1);

  // Log the closed position event (similar to finalizePosition)
  const pnl = calcPnlUSD(pos);
  const durationMs = pos.durationMs ?? ((pos.closeTime || pos.lastUpdate) - pos.openTime);
  logLine({
    type: 'close',
    address: pos.address,
    coin: pos.coin,
    pnlUsd: +pnl.toFixed(2),
    openSz: +pos.openSzAccum.toFixed(8),
    closeSz: +pos.closeSzAccum.toFixed(8),
    holdSec: Math.round(durationMs/1000),
    openTimeIso: fmtTS(pos.openTime),
    closeTimeIso: fmtTS(pos.closeTime || pos.lastUpdate)
  });

  if (closedSinceDump >= CONFIG.dumpAfter) {
    dumpClosed();
    closedSinceDump = 0;  // reset counter after dumping
  }
}


function shouldProcessForAggregation(tr, hasOpenPosForActorCoin, threshold) {
  const px = Number(tr.px), sz = Number(tr.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz)) return false;
  const notional = px * sz;
  // If we already have an open position for this (actor,coin) - we always process  if (hasOpenPosForActorCoin) return true;
  // Otherwise - only if it's a major launch  return notional >= threshold;
}

// side: B = aggressive buyer → LONG; A/S = aggressor-seller → SHORT
function labelFromSide(side) {
  if (side === 'B') return 'LONG';
  if (side === 'A' || side === 'S') return 'SHORT';
  return 'TRADE';
}

async function hlInfo(body) {
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Info API ${res.status}`);
  return res.json();
}

async function fetchUniverseCoins() {
  const meta = await hlInfo({ type: 'meta' });
  const coins = (meta.universe ?? []).map(x => x.name).filter(Boolean);
  if (!coins.length) throw new Error('universe пуст');
  return coins;
}

async function fetchRecentTrades(coin) {
  const data = await hlInfo({ type: 'recentTrades', coin });
  return Array.isArray(data) ? data : [];
}

// ---------- Positions status ----------
/*
Key — `${address}:${coin}`. The direction is stored explicitly.
Aggregate partial fills and calculate the VWAP for opening and closing.
If the opposite trade reverses the position, we split it: first, we close the remainder, then create a new one with the remaining volume.
*/
const openPositions = new Map();  // key -> pos
const closedPositions = [];       // array of completed positions (for dump)

setInterval(() => {
  const now = Date.now();
  for (const [key, p] of openPositions) {
    if (p.openSzAccum === 0 && p.size === 0 && (now - p.lastTs) > 10_000) {
      openPositions.delete(key);
      logLine({ type:'gc', key, reason:'phantom_zero' });
    }
    // extreme case: they hung after the WS break and there were already closures
    if (p.size === 0 && p.closeSzAccum > 0 && (now - p.lastTs) > 15_000) {
      finalizePosition(p);
      openPositions.delete(key);
      logLine({ type:'gc', key, reason:'late_finalize' });
    }
  }
  const rssMB = Math.round(process.memoryUsage().rss/1024/1024);
  logLine({ type:'health', openCount: openPositions.size, closedCount: closedPositions.length, rssMB });
}, 30_000);


function keyFor(addr, coin) { return `${addr}:${coin}`; }

// Creating a new position
function createPosition({ address, coin, direction, px, sz, time }) {
  const notional = px * sz;
  return {
    address, coin, direction,
    size: sz, // current position balance (>0)
    openNotional: notional, // sum of all opening trades
    openSzAccum: sz, // total open volume (for avgOpenPrice)
    avgOpenPrice: px, // opening VWAP
    closeNotional: 0, // sum of closing trades (accumulated)
    closeSzAccum: 0, // total closed volume (for avgClosePrice)
    avgClosePrice: null, // filled upon closing
    openTime: time,
    lastUpdate: time
  };
}

// Add an "opening" piece to the position (same direction)
function addOpen(pos, px, sz, time) {
  const oldValue = pos.avgOpenPrice * pos.openSzAccum;
  pos.openSzAccum += sz;
  pos.avgOpenPrice = (oldValue + px * sz) / pos.openSzAccum;
  pos.openNotional += px * sz;
  pos.size += sz;
  pos.lastUpdate = time;
}

// Apply a "closing" piece (opposite direction)
function applyClose(pos, px, incomingSz, time) {
  // we close no more than the current balance
  const closing = Math.min(pos.size, incomingSz);
  if (closing > EPS) {
    pos.size          = Math.max(0, pos.size - closing);
    pos.closeSzAccum  = (pos.closeSzAccum || 0) + closing;
    pos.closeNotional = (pos.closeNotional || 0) + px * closing;
    pos.lastUpdate    = time;
    if (pos.size <= EPS) {
      pos.size = 0;
      pos.avgClosePrice = pos.closeSzAccum ? (pos.closeNotional / pos.closeSzAccum) : null;
      pos.closeTime = time;
    }
  }
  // the remainder that did not fit into the closing - is the opening of a new position in the opposite direction
  const rest = incomingSz - closing;
  return rest > EPS ? rest : 0;
}

function calcPnlUSD(pos) {
  // for LONG: close - open; for SHORT: open - close
  const open = pos.openNotional || 0;
  const close = pos.closeNotional || 0;
  if (pos.direction === 'LONG') return close - open;
  if (pos.direction === 'SHORT') return open - close;
  return 0;
}

// Processing one trade (aggregate)
function handleTradeAggregate(tr, threshold) {
  const px = Number(tr.px), sz = Number(tr.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz)) return;

  const actor = tr.side === 'B' ? tr.users?.[0] : (tr.side === 'A' || tr.side === 'S') ? tr.users?.[1] : null;
  if (!actor) return;

  const k = keyFor(actor, tr.coin);
  const pos = openPositions.get(k);

  // Rule: If the position already exists, we always process it;
  // If the position doesn't exist, we only start processing if notional >= threshold
  if (!shouldProcessForAggregation(tr, !!pos, threshold)) return;

  const direction = labelFromSide(tr.side);
  const time = Number(tr.time);

  if (!pos) {
    const newPos = createPosition({ address: actor, coin: tr.coin, direction, px, sz, time });
    openPositions.set(k, newPos);
    return;
  }

  if (pos.direction === direction) {
    addOpen(pos, px, sz, time);
    return;
  }

  // close/revert
  let rest = applyClose(pos, px, sz, time);

  if (pos.size === 0) {
      // Position fully closed
      const closed = {
        ...pos,
        status: 'CLOSED',
        durationMs: ((pos.closeTime ?? time) - pos.openTime),
        pnlUsd: calcPnlUSD(pos),
        openTimeIso: fmtTS(pos.openTime),
        lastUpdateIso: fmtTS(pos.lastUpdate),
        closeTimeIso: fmtTS(pos.closeTime ?? pos.lastUpdate)
      };
      pushClosed(closed);
      openPositions.delete(k);
  }
}

// ---------- output of events by trades (optional) ----------
function maybePrintTradeEvent(tr, thresholdUSD) {
  const px = Number(tr.px), sz = Number(tr.sz);
  if (!Number.isFinite(px) || !Number.isFinite(sz)) return;
  const total = px * sz; if (total < thresholdUSD) return;

  const who = labelFromSide(tr.side);
  const buyer  = tr.users?.[0];
  const seller = tr.users?.[1];
  const actor  = (tr.side === 'B') ? buyer : (tr.side === 'A' || tr.side === 'S') ? seller : null;
  if (!actor) return;

  const tag = who === 'LONG' ? '[LONG] ' : who === 'SHORT' ? '[SHORT]' : '[TRADE]';
  console.log(`${tag} ${shortAddr(actor)} ${who === 'LONG' ? 'open' : 'open'} position ${tr.coin} size=${tr.sz} at $${tr.px}, total=${fmtUSD(total)}`);
}

// ---------- periodic table ----------
const RECENT_CLOSED_SHOW = 10;

function printLiveTable() {
  const rows = [...openPositions.values()]
    .sort((a,b)=> b.openNotional - a.openNotional)
    .map(p => ({
      address: shortAddr(p.address),
      coin: p.coin,
      dir: p.direction,
      size: p.size.toFixed(4),
      avgOpen: p.avgOpenPrice?.toFixed(2),
      openSum: fmtUSD(p.openNotional),
      currentSum: fmtUSD(currentOpenNotional(p)),
      last: fmtTS(p.lastUpdate),
      since: fmtTS(p.openTime),
      closedCnt: (closedCountByAddress.get(p.address) || 0)
    }));

  console.clear();
  console.log(`Open positions: ${rows.length}  |  Closed (buffer): ${closedPositions.length}  |  ${fmtTS(Date.now())} (UTC)`);
  if (rows.length) console.table(rows);

  if (closedPositions.length) {
    const recent = closedPositions.slice(-RECENT_CLOSED_SHOW).map(p => ({
      address: shortAddr(p.address),
      coin: p.coin,
      dir: p.direction,
      openSum: fmtUSD(p.openNotional),
      closeSum: fmtUSD(p.closeNotional || 0),
      pnl: fmtUSD(calcPnlUSD(p)),
      hold: fmtDuration(p.durationMs ?? ((p.closeTime || p.lastUpdate) - p.openTime)),
      openAt: fmtTS(p.openTime),
      closeAt: fmtTS(p.closeTime || p.lastUpdate),
      closedCnt: (closedCountByAddress.get(p.address) || 0)
    }));
    console.log('\nRecently closed:');
    console.table(recent);
  }
}

// ---------- dump of closed positions ----------
function dumpClosed() {
  if (!closedPositions.length) return;
  const fname = `closed_${Date.now()}.json`;
  try {
    const data = JSON.stringify(closedPositions, null, 2);
    fs.writeFileSync(fname, data);
    console.log(`\n💾 Dumped ${closedPositions.length} closed positions -> ${fname}`);
    // Keep up to RECENT_CLOSED_SHOW recent closed positions in memory for display
    const keepCount = Math.min(RECENT_CLOSED_SHOW, closedPositions.length);
    const keep = closedPositions.slice(-keepCount);
    closedPositions.length = 0;
    closedPositions.push(...keep);
  } catch (e) {
    console.error('Dump error:', e.message);
  }
}


// ---------- Start ----------
(async function main() {
    const args = parseArgs();

    CONFIG.threshold = Number.isFinite(args.threshold) ? args.threshold : CONFIG.threshold;
    CONFIG.dumpAfter = Number.isFinite(args.dumpAfter) ? args.dumpAfter : CONFIG.dumpAfter;

    console.log('Launch with parameters:', args);

    const coins = args.coins ?? await fetchUniverseCoins();
    console.log(`Coins (${coins.length}): ${coins.join(', ')}`);

    // Thin backmatch (if --from is specified): recentTrades by coin and filter by time
    if (args.from) {
    console.log(`Primary backmatch with ${fmtTS(args.from)} (limited by recentTrades depth).`);
    for (const coin of coins) {
        try {
        const batch = await fetchRecentTrades(coin);
        for (const t of batch) {
            if (!t.time || t.time < args.from) continue;
            // There may not be any users in recentTrades—such a trade is not suitable for aggregation (an actor is required)
            if (!t.users || !Array.isArray(t.users)) continue;
            const tr = { ...t, coin };
            handleTradeAggregate(tr);
            if (args.printTrades) maybePrintTradeEvent(tr, args.threshold);
        }
        await sleep(50);
        } catch (e) {
        console.warn('recentTrades', coin, e.message);
        }
    }
    }

    // Timers: table and dump every N minutes (optional)
    setInterval(printLiveTable, Math.max(1, args.tableEverySec) * 1000);
    // setInterval(dumpClosed, Math.max(1, args.dumpEveryMin) * 60 * 1000);

    // WS
    if (typeof WebSocket === 'undefined') throw new Error('Node 21+ required (global WebSocket).');

    connectWS(coins, (tr) => {
        handleTradeAggregate(tr, CONFIG.threshold);
        if (args.printTrades) maybePrintTradeEvent(tr, CONFIG.threshold);
    });

})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
