# Chit Slam (working name)

The childhood chit-passing game, online with friends. Pass the chits, make a set,
slam the floor, and don't be the last hand.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test           # 31 tests: rules + real multiplayer over sockets
```

Phones on the **same Wi-Fi** can join using the "on your Wi-Fi" address printed at
startup. To play with people elsewhere, deploy it (see below).

## How a round works

1. Everyone gets 3 (or 4) chits. Each word is on that many chits, plus one extra chit
   for the player who starts.
2. Turns go clockwise. On your turn you hold one chit more than a set: tap one to pass it
   to the next player, and it becomes their turn.
3. Holding a full set **on your turn**? Hit **BOOST!** The first hand lands on the mat
   *quietly*: small, soft thud, no alert. Everyone else has to notice.
4. Now there are no turns: everyone slams on top as fast as they can. Pile order = points
   (1st gets players-1 ... last gets 0).
5. The last hand gets a letter of **B-O-O-S-T** and starts the next round. Whoever spells
   the word ends the game. Most points wins.
6. BOOST without a set: −1 point (once per turn), and you still have to pass.

**Pace**

- With friends there's a turn timer (host picks 10/15/20/30 s, shown as a ring round the
  player's face). When it runs out, the game passes your least useful chit. It never slams for you.
- Two timed-out turns in a row marks you away (💤, short turns) until you touch anything.
- Alone with bots there's no timer: nothing moves until you do.
- Between rounds everyone taps **Ready**. With friends it also starts after 20 s; alone it waits for you.
- Bot speed: Relaxed (default), Normal or Fast.

**Characters**

Built from parts (skin, hair, hair colour, glasses, facial hair, an extra). Everyone gets a
random look on joining; tap 🎲 or change one part at a time in the waiting room. Bots get
ordinary first names.

## Fairness

- The server is the referee. Browsers only send "pass this chit" and "slam".
- Each player's network delay is measured every 2 s. Half of it, capped at 150 ms, is credited back
  when ordering the hand pile, so slow mobile data isn't automatically last.
- Disconnected players' seats keep passing on autopilot (they never slam), so a dropped phone
  doesn't freeze the circle. Refreshing the page rejoins the same seat.

## Privacy

- No accounts, email, phone number, cookies, analytics or third-party scripts/fonts.
- Rooms live in server memory only and are deleted when everyone leaves (or after 5 idle minutes).
- Each player only ever receives **their own** chits; others' hands are never sent.
- IP addresses are not stored (only a salted hash in memory for rate-limiting joins).
- Room codes go in the URL `#hash`, which browsers don't send to servers or other sites.
- Strict security headers (CSP, no-referrer, no framing), and sockets from other websites are refused.
- The host can remove players and **lock the room**.

## Project layout

```
server/game.js    rules (pure logic, fully tested)
public/avatar-parts.js  character parts, shared by server (checks) and browser (drawing)
server/packs.js   built-in chit categories
server/app.js     HTTP + WebSocket server, rate limits, security headers
public/           the browser game (no build step)
test/             node:test suites
```

## Deploying (when ready)

Any Node host with WebSocket support works (Render, Railway, Fly.io, a small VPS).
Run `npm start`, set `PORT` if needed, and `TRUST_PROXY=1` when it sits behind the host's proxy.
HTTPS is required for voice chat later.

## Roadmap

- **v2: voice chat** via a relay (TURN/SFU) so players' IP addresses stay hidden; per-player mute, host controls.
- Final name and branding (avoid "Boost" as the product name; it's a drink trademark).
- Optional language packs (Tamil, Telugu, Kannada, Malayalam interface text).
