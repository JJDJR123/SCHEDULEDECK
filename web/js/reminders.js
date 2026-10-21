/* 日程舱 — 提醒调度 */
import { state, save, setOverride } from './store.js';
import { fmtDue, fmtShort, relTime, MIN, DAY, sameDay, pad } from './util.js';

let onFire = () => {};
let audioCtx = null;

export function setNotifier(fn) { onFire = fn; }

export function permission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export function warmAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { audioCtx = new AC(); } catch { audioCtx = null; }
}

function beep() {
  if (!state.settings.sound) return;
  warmAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const t0 = audioCtx.currentTime;
  [880, 1174].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = t0 + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.24);
  });
}

function systemNotify(title, body, tag) {
  if (!state.settings.notify) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body, tag, silent: true, requireInteraction: false,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"%3E%3Crect width="64" height="64" rx="16" fill="%235B5BF0"/%3E%3Cpath d="M18 33l9 9 19-20" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E',
    });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
  } catch { /* ignore */ }
}

function offsetLabel(min) {
  if (min === 0) return '现在';
  if (min % 1440 === 0) return `${min / 1440} 天`;
  if (min % 60 === 0) return `${min / 60} 小时`;
  return `${min} 分钟`;
}

export function fireTest() {
  beep();
  systemNotify('日程舱 · 测试提醒', '通知通道正常，到点我会提醒你。', 'test-' + Date.now());
  onFire({
    type: 'test',
    title: '测试提醒已发送',
    body: state.settings.notify ? '如果系统没有弹出通知，请在 Windows 设置里允许浏览器通知。' : '系统通知已关闭，仅显示应用内提醒。',
  });
}

function fireRecord(rec, kind, offset) {
  const rel = relTime(rec.due);
  let title;
  if (kind === 'snooze') title = `稍后提醒 · ${rec.title}`;
  else if (kind === 'overdue') title = `已逾期 · ${rec.title}`;
  else if (offset === 0) title = `到点了 · ${rec.title}`;
  else title = `即将到期 · ${rec.title}`;
  const body = rec.due != null ? `${fmtDue(rec.due)} · ${rel.text}` : '未设置截止时间';
  systemNotify(title, body, rec.id);
  beep();
  onFire({ type: 'task', rec, title, body });
}

function stamp(key) {
  state.reminders.fired[key] = Date.now();
}

function prune() {
  const cutoff = Date.now() - 30 * DAY;
  const f = state.reminders.fired;
  Object.keys(f).forEach((k) => { if (f[k] < cutoff) delete f[k]; });
}

export function tick() {
  const now = Date.now();
  let changed = false;

  for (const rec of state.records) {
    if (rec.done) continue;

    if (rec.snoozeUntil && now >= rec.snoozeUntil && now < rec.snoozeUntil + 20 * MIN) {
      const key = `sn:${rec.id}:${Math.round(rec.snoozeUntil / MIN)}`;
      if (!state.reminders.fired[key]) {
        stamp(key);
        state.overrides[rec.id] = { ...(state.overrides[rec.id] || {}), snoozeUntil: null };
        rec.snoozeUntil = null;
        fireRecord(rec, 'snooze');
        changed = true;
      }
    }

    if (rec.due == null) continue;
    const offsets = Array.isArray(rec.reminders) && rec.reminders.length
      ? rec.reminders : state.settings.defaultReminders;
    for (const off of offsets) {
      if (off == null) continue;
      const trigger = rec.due - off * MIN;
      const key = `${rec.id}:${off}:${Math.round(rec.due / MIN)}`;
      if (now >= trigger && now <= trigger + 30 * MIN && !state.reminders.fired[key]) {
        stamp(key);
        fireRecord(rec, 'due', off);
        changed = true;
      }
    }
  }

  changed = digestTick(now) || changed;
  if (changed) { prune(); save(); }
}

function digestTick(now) {
  const at = state.settings.dailyDigest;
  if (!at) return false;
  const [hh, mm] = at.split(':').map(Number);
  const today = new Date(now); today.setHours(hh || 9, mm || 0, 0, 0);
  if (now < today.getTime()) return false;
  const key = `digest:${fmtShort(today.getTime())}`;
  if (state.reminders.fired[key]) return false;

  const open = state.records.filter((r) => !r.done);
  const dueToday = open.filter((r) => r.due != null && sameDay(r.due, now));
  const overdue = open.filter((r) => r.due != null && r.due < now);
  if (!dueToday.length && !overdue.length) return false;

  stamp(key);
  const lines = [];
  if (dueToday.length) lines.push(`今天 ${dueToday.length} 项到期`);
  if (overdue.length) lines.push(`${overdue.length} 项已逾期`);
  const title = '今日早报 · ' + lines.join(' · ');
  const body = [...overdue, ...dueToday].filter((r, i, a) => a.indexOf(r) === i)
    .slice(0, 4).map((r) => '· ' + r.title).join('\n');
  systemNotify(title, body, 'digest');
  beep();
  onFire({ type: 'digest', title, body });
  return true;
}

export function start() {
  setTimeout(tick, 2500);
  setInterval(tick, 15000);
}

/* ------------------------------------------------------------------ 查询 */

export function upcoming(limit = 40) {
  const now = Date.now();
  const map = new Map();
  const push = (rec, at, label) => {
    if (!at || at <= now) return;
    const prev = map.get(rec.id);
    if (!prev || at < prev.at) map.set(rec.id, { rec, at, label });
  };
  for (const rec of state.records) {
    if (rec.done) continue;
    if (rec.snoozeUntil && rec.snoozeUntil > now) push(rec, rec.snoozeUntil, '稍后提醒');
    if (rec.due == null) continue;
    const offsets = Array.isArray(rec.reminders) && rec.reminders.length
      ? rec.reminders : state.settings.defaultReminders;
    offsets.forEach((off) => {
      push(rec, rec.due - off * MIN, off === 0 ? '到期时' : `提前 ${offsetLabel(off)}`);
    });
  }
  return [...map.values()].sort((a, b) => a.at - b.at).slice(0, limit);
}

export function recentFired(limit = 10) {
  return Object.entries(state.reminders.fired)
    .filter(([k]) => !k.startsWith('sn:') && !k.startsWith('digest:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, at]) => {
      const id = key.split(':')[0];
      return { rec: state.byId.get(id), at, key };
    })
    .filter((x) => x.rec);
}

export function snooze(id, minutes) {
  setOverride(id, { snoozeUntil: Date.now() + minutes * MIN });
}

export function clearSnooze(id) {
  setOverride(id, { snoozeUntil: null });
}

export function setTaskReminders(id, offsets) {
  setOverride(id, { reminders: offsets });
}

export function resetTaskReminders(id) {
  setOverride(id, { reminders: null });
}

export { offsetLabel };
