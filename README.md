## ⚡ Hyperliquid Perp Realtime Monitor

A real-time monitor that listens to the public Hyperliquid WS, aggregates partial position fills by address, calculates VWAP, PnL, and holding time, tracks partial/full closes and reversals, displays a live table, and saves closed positions to files.

## ✅ Requirements and recommendations

Node.js 21+ — required for global fetch and WebSocket in Node.

Windows (recommended) — there is an interactive launcher perp_monitor.bat.

If you have Node < 21, the program will still run, but there may be limitations (no autologging via batch file, etc.).

## Clone the repository

`git clone https://github.com/wfofw/perp_stats.git perp`

`cd perp`


## ▶️ Start
### Option A - Direct (cross-platform)
`node main.mjs [parameters]`

### Option B - Windows Launcher

Double-click perp_monitor.bat → enter parameters interactively → run.

Logs (if enabled) are written to `./logs/perp_YYYYMMDD_HHmmss.log.`

## 🔧 Parameters
| Flag | Description | Default value |
|:---|:---|:---|
|`--threshold <USD>`   |	Minimum trade size to start a NEW position	                       |`50000`|
|`--coins BTC,ETH`     |  Restrict markets	                                                 |`all perp-markets from meta`|
|`--from <ISO	ms>`     |  Thin backmatch via recentTrades (limited by response depth)        |`null`|
|`--print-trades`      |  Print large trades by threshold (does not affect aggregation)      |`false`|
|`--table-sec <N>`	   |  Live table update period in seconds	                               |`5`|
|`--dump-after <N>`    |  Dump after N closed positions in closed_<timestamp>.json	         |`10`|

### ! Important information about threshold !

When there is no position, a new one is created only if price*size >= threshold;

When a position already exists, all trades are always processed (even those below the threshold) to avoid partial closings/reversals.

## 👀 View in the CLI

The program draws a live table of open positions (updated every --table-sec):
|    address   |coin|    dir   |     size    |          avgOpen        |            openSum          |     currentSum     |           last            |         since        |                  closedCnt                |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
|wallet address|coin|LONG/SHORT|current volume|avg entry price (VWAP)|the sum of all opening transactions|current transaction amount|last update time|time of first opening|number of positions this address closed during the session|

### Dump (--dump-after N) contains an array of dictionaries with closed positions
#### Example
```
  {
    "address": "0xb28cf8649d1cda2975d290f04ea4cc4db7b3828e",
    "coin": "BTC",
    "direction": "SHORT",
    "size": 0,
    "openNotional": 1850992.6704900002,
    "openSzAccum": 16.14622,
    "avgOpenPrice": 114639.38126013396,
    "closeNotional": 1860720.477580001,
    "closeSzAccum": 16.14622000000001,
    "avgClosePrice": 115241.86327078412,
    "openTime": 1760303298224,
    "lastUpdate": 1760306793190,
    "closeTime": 1760306793190,
    "status": "CLOSED",
    "durationMs": 3494966,
    "pnlUsd": -9727.807090000948
  }
```
## 🧠 Aggregation logic (briefly)

—> Position key: address + coin.

—> Partial fills add up to one position: VWAP, total size, sum of openings.

### In the opposite transaction:

—> Closing min(currentSize, incomingSize);

—> If the position became 0 → we consider it closed, move it to closedPositions;

—> The remainder (if there was more) is a reversal → we open a new position in the other direction.

—> Hold time: closeTime - openTime (in ms), formatted in hold.

## 💾 Examples

### Track all transactions from $50k

`node main.mjs`

### BTC and ETH only, trades from $100k, print major events
`node main.mjs --coins BTC,ETH --threshold 100000 --print-trades`

### Dump after 5 closed positions, quick table update
`node main.mjs --dump-after 5 --table-sec 3`

### Pull up some history (if recentTrades still holds)
`node main.mjs --from "2025-10-10T00:00:00Z"`
