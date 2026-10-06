// Bremse unter Last: N falsche Codes gleichzeitig, danach gefälschte IP-Header. Nur falsche Codes.
// Sperrt die eigene IP für 10 Minuten auf diesem Deployment, darum nie gegen die Produktion.
//   node tests/live/bremse-parallel.mjs --basis https://<hash>.<projekt>.pages.dev [--anzahl 25]
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { basis: { type: 'string' }, anzahl: { type: 'string' } }, strict: true });
const basis = new URL(values.basis).origin;
const n = Number(values.anzahl || 25);
const falsch = (i, kopf = {}) => fetch(`${basis}/api/zugang`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...kopf },
  body: JSON.stringify({ code: `ZZZZZZZ${'ABCDEFGHJKMNPQRSTUVWXYZ'[i % 23]}` }),
}).then(async (r) => { await r.arrayBuffer(); return r.status; });
const zaehle = (l) => l.reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {});
const t = Date.now();
const welle = await Promise.all(Array.from({ length: n }, (_, i) => falsch(i)));
console.log(`${n} parallel:`, JSON.stringify(zaehle(welle)), `${Date.now() - t} ms`);
const danach = [];
for (let i = 0; i < 3; i++) danach.push(await falsch(i));
console.log('danach seriell:', JSON.stringify(zaehle(danach)));
const gefaelscht = [];
for (let i = 0; i < 3; i++) gefaelscht.push(await falsch(i, { 'CF-Connecting-IP': `203.0.113.${i + 1}`, 'X-Forwarded-For': `203.0.113.${i + 1}`, 'True-Client-IP': `203.0.113.${i + 1}` }));
console.log('mit gefälschten IP-Headern:', JSON.stringify(zaehle(gefaelscht)));
