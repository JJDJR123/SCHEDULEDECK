/* 日程舱 — 基础 UI 组件：图标 / toast / 抽屉 / 弹窗 */
import { esc } from './util.js';

const layerRoot = document.getElementById('layerRoot');
const toastRoot = document.getElementById('toastRoot');
const stack = [];

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function toast({ type = 'info', title, text = '', actions = [], duration = 5200 }) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = { ok: 'check-circle', warn: 'alert', err: 'alert', info: 'info' };
  el.innerHTML = `
    <div class="t-icon">${icon(icons[type] || 'info')}</div>
    <div class="t-body">
      <div class="t-title">${esc(title)}</div>
      ${text ? `<div class="t-text">${esc(text)}</div>` : ''}
      ${actions.length ? `<div class="t-actions">${actions.map((a, i) => `<button data-ti="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>
    <button class="t-close" aria-label="关闭">${icon('x')}</button>`;
  el.querySelector('.t-close').addEventListener('click', () => el.remove());
  el.querySelectorAll('[data-ti]').forEach((b) => {
    b.addEventListener('click', () => {
      const a = actions[Number(b.dataset.ti)];
      el.remove();
      if (a && a.onClick) a.onClick();
    });
  });
  toastRoot.appendChild(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
  return el;
}

function pushLayer(el, onClose) {
  const entry = { el, onClose, closed: false };
  entry.close = () => {
    if (entry.closed) return;
    entry.closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    el.style.animation = 'fade .12s ease reverse';
    setTimeout(() => el.remove(), 110);
    if (entry.onClose) entry.onClose();
  };
  layerRoot.appendChild(el);
  stack.push(entry);
  el.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => entry.close());
  });
  return entry;
}

export function closeTop() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function closeAll() {
  while (stack.length) closeTop();
}

export function drawer({ title = '', subtitle = '', body = '', footer = '', wide = false, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-backdrop';
  wrap.innerHTML = `
    <aside class="drawer ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="drawer-head">
        <div style="min-width:0">
          <h2>${title}</h2>
          ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body">${body}</div>
      ${footer ? `<div class="drawer-foot">${footer}</div>` : ''}
    </aside>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeTop(); });
  const closeWrap = () => {
    if (onClose) onClose();
    setTimeout(() => {
      if (!document.querySelector('.drawer-backdrop')) delete document.body.dataset.drawer;
    }, 160);
  };
  const handle = pushLayer(wrap, closeWrap);
  document.body.dataset.drawer = '1';
  const drawerEl = wrap.querySelector('.drawer');
  handle.setBody = (html) => {
    const b = drawerEl.querySelector('.drawer-body');
    b.innerHTML = html;
    return b;
  };
  handle.setFooter = (html) => {
    let f = drawerEl.querySelector('.drawer-foot');
    if (!f) {
      f = document.createElement('div');
      f.className = 'drawer-foot';
      drawerEl.appendChild(f);
    }
    f.innerHTML = html;
    return f;
  };
  handle.el = wrap;
  handle.panel = drawerEl;
  if (onMount) onMount(handle);
  return handle;
}

export function modal({ title = '', subtitle = '', body = '', footer = '', slim = false, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${slim ? 'slim' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div style="min-width:0">
          <h2>${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeTop(); });
  const handle = pushLayer(wrap, onClose);
  handle.el = wrap;
  handle.modal = wrap.querySelector('.modal');
  handle.setBody = (html) => { handle.modal.querySelector('.modal-body').innerHTML = html; };
  handle.setFooter = (html) => {
    let f = handle.modal.querySelector('.modal-foot');
    if (!f) {
      f = document.createElement('div');
      f.className = 'modal-foot';
      handle.modal.appendChild(f);
    }
    f.innerHTML = html;
    return f;
  };
  if (onMount) onMount(handle);
  return handle;
}

export function confirmDialog({ title = '确认操作', text = '', confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; closeTop(); resolve(v); };
    const m = modal({
      title: esc(title),
      slim: true,
      body: `<p style="margin:0;font-size:12.8px;line-height:1.7;color:var(--text-2)">${text}</p>`,
      footer: `
        <span class="spacer"></span>
        <button class="btn ghost" data-no>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => done(false),
    });
    m.el.querySelector('[data-yes]').addEventListener('click', () => done(true));
    m.el.querySelector('[data-no]').addEventListener('click', () => done(false));
  });
}

export function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin">${icon('refresh')}</span>${label || '处理中…'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

export function switchHtml(checked, attrs = '') {
  return `<button class="switch" role="switch" aria-checked="${checked ? 'true' : 'false'}" ${attrs}></button>`;
}
