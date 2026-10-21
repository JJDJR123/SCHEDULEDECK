'use strict';
/* 用真实登录态导入指定 sheet，并在浏览器里跑排期识别 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:17890';
// 表链接从命令行传，别写进仓库：node tools/detect-test.js "https://xxx.feishu.cn/wiki/...?sheet=..."
const URL = process.argv[2];
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!URL) {
    console.error('用法：node tools/detect-test.js "https://xxx.feishu.cn/wiki/...?sheet=xxxx"');
    process.exit(1);
  }
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(os.tmpdir(), 'sd-det-' + Date.now())}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--window-size=1440,940', 'about:blank',
  ], { stdio: 'ignore' });

  let ok = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ok = true; break; } catch { /* wait */ }
  }
  if (!ok) throw new Error('chrome not ready');
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/?view=tasks' });
  await sleep(2000);

  const expr = `(async()=>{
    const store = await import('/js/store.js');
    const res = await fetch('/api/oauth/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:${JSON.stringify(URL)}})});
    const j = await res.json();
    if(!j.ok) return JSON.stringify({ok:false,error:j.error});
    const d = j.data;
    const det = store.detectSchedule(d.headers, d.rows);
    store.applyImport(d);
    return JSON.stringify({ok:true,headers:d.headers,first:d.rows[0],rows:d.rows.length,det,records:store.state.records.length});
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const value = r.result && r.result.value;
  fs.writeFileSync(path.join(__dirname, '..', 'tmp-detect.json'), value || JSON.stringify(r), 'utf8');
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', 'shots', '30-schedule.png'), Buffer.from(shot.data, 'base64'));
  console.log('done');

  ws.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
