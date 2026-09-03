<p align="center">
  <a href="https://nodejs.org/en/download/"><img src="https://img.shields.io/badge/Node.js-21+-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 21+"></a>
</p>

# 🖥 Hyperliquid Perpetuals Monitor

Hyperliquid Perpetuals Monitor is a tool for collecting and analyzing perpetual futures trades in real time.

It collects newly reported perpetual futures fills from Hyperliquid in real time, aggregates positions by address/coin, calculates open/close (VWAP), displays a live table, and dumps closed positions.

⚠️ *If you have Node < 21, the program will still run, but there may be limitations (no autologging via batch file, etc.).*

## 🌟 Highlights

- A convenient table with auto-updates right in the terminal.
- Aggregates partial position fills by address
- Ability to start tracking deals from an arbitrary date in the past

## ℹ️ Overview

The goal is to track and store trades—both historical and real-time—and to perform analytics based on the collected data.

The [Hyperliquid WS](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket) served as the foundation, and the following features were implemented:

- Aggregation of partial fills into a single position (a single actual position may consist of multiple trades)
- Mapping fills to the correct wallet address
- Logic for partial position closures and reversals
- WebSocket reconnection after prolonged operation

Long-running WebSocket connections may experience disconnects or gaps in the local event stream. 

The monitor therefore includes reconnection and state-recovery logic to reduce divergence between the local position model and incoming market events

## ⚙️ Installation & Setup

Clone the repository:

```bash
git clone https://github.com/wfofw/hl_monitor.git hl_monitor
cd hl_monitor
```

### 📍 Option A - Direct (cross-platform)

You can launch the project from the terminal by manually entering the command and the optional parameters listed below.

| Flag | Description | Default value |
|:---|:---|:---|
|`--threshold <USD>`   |	Minimum trade size to start a NEW position	                                         |`50000`|
|`--coins BTC,ETH`     |  Restrict markets	                                                                   |`all perp-markets from meta`|
|`--from <ISO>`        |  Backfill recent trades from the specified time, subject to API response depth        |`null`|
|`--print-trades`      |  Print trades that meet the configured threshold                                      |`false`|
|`--table-sec <N>`	   |  Live table update period in seconds	                                                 |`5`|
|`--dump-after <N>`    |  Write closed positions to JSON after N positions are closed	                         |`10`|

Examples:

All coins, threshold $50k, table every 5 seconds:

```bash
node main.mjs
```
Track only BTC and ETH, trades over $100k:

```bash
node main.mjs --coins BTC,ETH --threshold 100000
```

Print incoming trades to the console, dump after 5 closed positions:

```bash
node main.mjs --print-trades --dump-after 5
```

### 📍 Option B - Windows Launcher

1. Double-click perp_monitor.bat
2. Enter parameters interactively
3. The program will start collecting trades

Logs (if enabled) are written to `./logs/perp_YYYYMMDD_HHmmss.log`

#### 👀 View in the CLI

The program draws a live table of open positions (updated every --table-sec):
|    address   |coin|    dir   |     size    |          avgOpen        |            openSum          |     currentSum     |           last            |         since        |                  closedCnt                |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
|wallet address|coin|LONG/SHORT|current volume|avg entry price (VWAP)|the sum of all opening transactions|current transaction amount|last update time|time of first opening|number of positions this address closed during the session|

### ❗️ Important information about threshold

When there is no position, a new one is created only if price*size >= threshold;

When a position already exists, all trades are always processed (even those below the threshold) to avoid partial closings/reversals.

## 📚 Dump example
```json
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
### Position lifecycle

For an opposite-direction fill:

1. Close `min(currentSize, incomingSize)`.
2. If the remaining position size is `0`, the position is marked as `CLOSED`.
3. If the incoming fill exceeds the current position size, the remainder opens a new position in the opposite direction.
4. Holding time is calculated as `closeTime - openTime`.
