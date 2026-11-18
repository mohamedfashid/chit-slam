import { networkInterfaces } from 'node:os';
import { createGameServer } from './app.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const server = createGameServer({
  trustProxy: process.env.TRUST_PROXY === '1',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
});

const actual = await server.listen(port, host);
console.log(`Chit Slam running:  http://localhost:${actual}`);
// Show local-network addresses so phones on the same Wi-Fi can join.
for (const list of Object.values(networkInterfaces())) {
  for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  on your Wi-Fi:     http://${a.address}:${actual}`);
  }
}

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
