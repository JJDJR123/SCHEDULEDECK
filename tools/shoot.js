'use strict';
/* 视觉/运行时自检：启动无头 Chrome，通过 CDP 逐屏截图并收集控制台错误 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:17890';
const OUT = path.join(__dirname, '..', 'shots');
const PROFILE = path.join(os.tmpdir(), 'sd-cdp-' + Date.now());
const PORT = 9333;

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
    '--window-size=1440,940', 'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      version = await r.json();
      break;
    } catch { /* wait */ }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

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
      logs.push('EXCEPTION: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      logs.push('LOG: ' + m.params.entry.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('CONSOLE: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  });

  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result && r.result.value;
  };

  const shot = async (name) => {
    await sleep(120);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('shot', name);
  };

  const go = async (url) => {
    await send('Page.navigate', { url });
    await sleep(1600);
  };

  const click = async (sel) => {
    const ok = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true;})()`);
    await sleep(450);
    if (!ok) logs.push('MISSING: ' + sel);
  };

  const esc = async () => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(320);
  };

  await go(BASE + '/?view=overview');
  await shot('01-overview.png');

  await click('[data-view="tasks"]');
  await shot('02-tasks.png');

  await click('.task-main');
  await shot('03-task-detail.png');
  await esc();

  await click('#btnImport');
  await shot('04-import.png');
  await esc();

  await go(BASE + '/?view=table');
  await shot('05-table.png');

  await go(BASE + '/?view=calendar');
  await shot('06-calendar.png');

  await go(BASE + '/?view=rules');
  await shot('07-rules.png');
  await click('[data-act="rule-edit"]');
  await shot('08-rule-editor.png');
  await esc();

  await click('#btnSettings');
  await shot('09-settings.png');
  await click('[data-k="tab"][data-v="mapping"]');
  await shot('10-mapping.png');
  await esc();

  await click('#btnBell');
  await shot('11-reminders.png');
  await esc();

  await evaluate(`document.documentElement.dataset.theme='dark'`);
  await go(BASE + '/?view=tasks');
  await evaluate(`document.documentElement.dataset.theme='dark'`);
  await shot('12-dark.png');

  const counts = await evaluate(`({tasks:document.querySelectorAll('.task').length, rules:document.querySelectorAll('.rule-card').length, title:document.title})`);
  console.log('counts', JSON.stringify(counts));

  console.log('--- errors ---');
  console.log(logs.length ? logs.join('\n') : '(none)');

  ws.close();
  try { await fetch(`http://127.0.0.1:${PORT}/json/close/${page.id}`); } catch { /* ignore */ }
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
