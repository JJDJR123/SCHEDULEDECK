/* 日程舱 — 启动与全局逻辑 */
import { state, loadState, applyImport, toggleDone, save } from './store.js';
import { initUI, render } from './ui.js';
import * as panels from './panels.js';
import { start as startReminders, setNotifier, warmAudio, snooze } from './reminders.js';
import { toast, setBusy, closeTop, layersSuppressed } from './kit.js';
import { fmtDue } from './util.js';

async function boot() {
  try {
    await loadState();
  } catch (err) {
    console.error(err);
  }

  panels.applyTheme();
  panels.applyDensity();
  panels.applyMyColor();
  panels.setRefresh(() => render());
  initUI();

  const params = new URLSearchParams(location.search);
  const wantView = params.get('view') || location.hash.replace('#', '');
  if (['overview', 'tasks', 'calendar', 'table', 'rules'].includes(wantView)) {
    state.ui.view = wantView;
  }
  render();

  setNotifier(onReminder);
  startReminders();
  wireGlobal();
  updateNotifyHint();
  setTimeout(autoSync, 2600);
  loadMyName();
  pushUpdateConfig();
  // 每次打开都检查一次更新（没配更新地址就不打扰）
  setTimeout(() => { if (state.settings.manifestUrl) panels.openUpdate(); }, 3800);
}

/** 把「自动更新地址」同步给启动器（它读 data/update.json） */
async function pushUpdateConfig() {
  try {
    if (!state.settings.manifestUrl) return;
    await fetch('/api/update-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestUrl: state.settings.manifestUrl }),
    });
  } catch { /* 离线就算了 */ }
}

async function loadMyName() {
  try {
    const j = await (await fetch('/api/oauth/status', { cache: 'no-store' })).json();
    if (j && j.loggedIn && j.user && j.user.name && !state.settings.myName) {
      state.settings.myName = j.user.name;
      save();
      render();
    }
  } catch { /* ignore */ }
}

/** 同步当前这条数据源：把它的链接一起带上，服务端才不会去同步「上次导入的那张表」 */
function syncReq(src) {
  return fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: src && src.url ? src.url : '' }),
  });
}

async function autoSync() {
  const src = state.source;
  if (!src || src.kind !== 'feishu' || !src.url) return;
  if (Date.now() - (src.lastSync || 0) < 10 * 60 * 1000) return;
  try {
    const res = await syncReq(src);
    const json = await res.json();
    if (json.ok) {
      applyImport(json.data);
      render();
      toast({ type: 'ok', title: '已自动同步飞书表格', text: `${json.data.rows.length} 行数据` });
    }
  } catch { /* 离线时保持本地数据 */ }
}

function onReminder(payload) {
  if (!payload) return;
  const actions = [];
  if (payload.type === 'task' && payload.rec) {
    const rec = payload.rec;
    actions.push({
      label: '标记完成',
      onClick: () => { toggleDone(rec.id); render(); },
    });
    actions.push({
      label: '稍后 10 分钟',
      onClick: () => { snooze(rec.id, 10); render(); },
    });
  }
  toast({
    type: payload.type === 'digest' ? 'info' : 'warn',
    title: payload.title,
    text: payload.body,
    actions,
    duration: 12000,
  });
  if (payload.type === 'digest') render();
}

function updateNotifyHint() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default' && state.source && state.source.kind !== 'demo') {
    // 不主动弹权限，交给提醒中心/设置里的按钮
  }
}

async function syncNow() {
  const src = state.source;
  if (!src || src.kind === 'demo' || !src.url) {
    panels.openImport();
    return;
  }
  if (src.kind !== 'feishu') {
    toast({ type: 'warn', title: '这个数据源不能自动同步', text: '粘贴/文件导入的数据，请重新粘贴一次。' });
    return;
  }
  const btn = document.getElementById('btnRefresh');
  setBusy(btn, true, '');
  try {
    const res = await syncReq(src);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '同步失败');
    applyImport(json.data);
    render();
    toast({ type: 'ok', title: '已同步飞书表格', text: `${json.data.rows.length} 行数据` });
  } catch (err) {
    toast({ type: 'err', title: '同步失败', text: err.message, duration: 10000 });
  } finally {
    setBusy(btn, false);
  }
}

function wireGlobal() {
  window.__syncNow = syncNow;
  window.__openImport = () => { closeTop(); panels.openImport(); };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-import]');
    if (b) panels.openImport();
  }, true);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const s = document.getElementById('searchInput');
      if (s) { s.focus(); s.select(); }
      return;
    }
    if (e.key === 'Escape') {
      // 刚关掉原生弹窗（取色器/选文件/下拉）时，这一下 Esc 不算「关抽屉」
      if (layersSuppressed()) return;
      if (closeTop()) e.preventDefault();
    }
    if (mod && e.key.toLowerCase() === 'r' && e.shiftKey) {
      e.preventDefault();
      syncNow();
    }
  });

  document.addEventListener('pointerdown', () => warmAudio(), { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render({ keepScroll: true, onlyView: true });
  });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (document.querySelector('.drawer-backdrop, .modal-backdrop')) return;
    render({ keepScroll: true, onlyView: true });
  }, 60000);
}

boot();
