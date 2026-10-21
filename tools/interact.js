'use strict';
/* 交互自检：完成勾选、持久化、粘贴导入、新建规则 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:17890';
const OUT = path.join(__dirname, '..', 'shots');
const PROFILE = path.join(os.tmpdir(), 'sd-cdp-i-' + Date.now());
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--disable-extensions', '--window-size=1440,940', 'about:blank',
  ], { stdio: 'ignore' });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); ready = true; break; } catch { /* wait */ }
  }
  if (!ready) throw new Error('chrome not ready');

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const logs = [];
  let seq = 0;

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('EXCEPTION: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG: ' + m.params.entry.text);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    await sleep(150);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('shot', name);
  };
  const click = async (sel) => {
    const ok = await ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.click();return true})()`);
    await sleep(500);
    if (!ok) throw new Error('missing ' + sel);
  };
  const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(1600); };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false });

  await go(BASE + '/?view=tasks');
  console.log('initial tasks', await ev(`document.querySelectorAll('.task').length`));

  await click('.task .check');
  console.log('after check, done =', await ev(`document.querySelectorAll('.task.is-done').length`));
  await shot('20-done.png');

  await sleep(1200);
  await go(BASE + '/?view=tasks');
  console.log('after reload, done =', await ev(`document.querySelectorAll('.task.is-done').length`));

  await click('#btnImport');
  await click('[data-k="tab"][data-v="paste"]');
  await ev(`(()=>{const ta=document.querySelector('#pasteBox');
    ta.value='任务\\t截止时间\\t状态\\t标签\\t优先级\\t负责人\\t备注\\n写周报\\t2026-10-22 18:00\\t未开始\\t工作\\t高\\t我\\t测试导入\\n买咖啡豆\\t2026-10-24\\t未开始\\t生活\\t低\\t我\\t';
    ta.dispatchEvent(new Event('input',{bubbles:true}));return ta.value.length})()`);
  await click('[data-k="parse"]');
  await sleep(300);
  await shot('21-paste-preview.png');
  await click('[data-k="import-paste"]');
  await sleep(800);
  console.log('tasks after import', await ev(`document.querySelectorAll('.task').length`));
  console.log('toast', await ev(`document.querySelector('.toast .t-title')?.textContent||''`));
  await shot('22-paste-imported.png');

  await go(BASE + '/?view=rules');
  console.log('rules before', await ev(`document.querySelectorAll('.rule-card').length`));
  await click('[data-act="rule-new"]');
  await click('[data-k="save"]');
  await sleep(500);
  console.log('rules after', await ev(`document.querySelectorAll('.rule-card').length`));
  await shot('23-rule-created.png');

  console.log('--- errors ---');
  console.log(logs.length ? logs.join('\n') : '(none)');
  ws.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 400);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
