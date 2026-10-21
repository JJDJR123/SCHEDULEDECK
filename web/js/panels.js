/* 日程舱 — 抽屉 / 弹窗面板 */
import {
  state, save, toggleDone, setOverride, setMapping, applyImport, loadDemo,
  clearAll, exportJSON, autoMap, DEFAULT_RULES, rebuild, detectSchedule, canEdit,
  setScheduleCol, setRoleOwnerCol, toggleRoleDateCol,
} from './store.js';
import {
  evalRules, resolveStyle, styleVars, FIELDS, PALETTE, newRule, sampleRecord,
  describeRule, opsFor, durationMs,
} from './rules.js';
import { icon, toast, drawer, modal, confirmDialog, setBusy, switchHtml } from './kit.js';
import {
  esc, fmtDue, fmtShort, relTime, fmtDate, parseDelimited, download,
  MIN, HOUR, DAY, startOfDay, addDays,
} from './util.js';
import {
  permission, requestPermission, fireTest, upcoming, recentFired,
  offsetLabel, snooze, clearSnooze, setTaskReminders, resetTaskReminders,
} from './reminders.js';

let refresh = () => {};
export function setRefresh(fn) { refresh = fn; }

const REMINDER_PRESETS = [
  { v: 0, label: '准时' }, { v: 10, label: '10 分钟' }, { v: 15, label: '15 分钟' }, { v: 30, label: '30 分钟' },
  { v: 60, label: '1 小时' }, { v: 120, label: '2 小时' }, { v: 1440, label: '1 天' },
  { v: 2880, label: '2 天' }, { v: 10080, label: '7 天' },
];

/* ========================================================================== */
/* 任务详情                                                                   */
/* ========================================================================== */

export function openTask(id, { focusReminder = false } = {}) {
  const rec = state.byId.get(id);
  if (!rec) return;
  const now = Date.now();
  const rule = evalRules(rec, now);
  const st = rule ? resolveStyle(rule, rec, now) : null;
  const srcUrl = state.source && state.source.url;
  // 排期表由老板和各负责人维护，这里只让本人改自己那一块
  const editable = !(state.schedule && state.schedule.enabled) || canEdit(rec);

  const h = drawer({
    title: `<span style="font-size:15px">${esc(rec.title)}</span>`,
    subtitle: `${esc(rec.status || '无状态')} · ${rec.due != null ? esc(fmtDue(rec.due, now)) : '未设截止'}`,
    body: '',
    footer: `
      ${editable ? `<button class="btn ${rec.done ? 'ghost' : 'primary'}" data-k="toggle">
        ${icon('check')}${rec.done ? '标记未完成' : '标记完成'}
      </button>` : '<span class="hint" style="flex:1">这块不是你负责的，只读</span>'}
      <span class="spacer"></span>
      ${srcUrl ? `<a class="btn ghost" href="${esc(srcUrl)}" target="_blank" rel="noreferrer">${icon('external')}打开飞书</a>` : ''}
      <button class="btn ghost" data-close>关闭</button>`,
  });

  const body = () => {
    const r2 = state.byId.get(id) || rec;
    const offsets = Array.isArray(r2.reminders) && r2.reminders.length ? r2.reminders : state.settings.defaultReminders;
    const isDefault = !(Array.isArray(r2.reminders) && r2.reminders.length);
    const snoozed = r2.snoozeUntil && r2.snoozeUntil > Date.now();
    const rel = relTime(r2.due, now);
    return `
      ${st ? `<div class="task-preview" style="${styleVars(st)}">
        <div class="tp-badge">${esc(st.badge || rule.name)}</div>
        <div class="tp-title">${esc(r2.title)}</div>
        <div class="tp-sub">${esc(rule.name)} · ${esc(fmtDue(r2.due, Date.now()))}</div>
      </div>` : ''}

      <div class="kv">
        <div class="kv-row"><span>状态</span><b>${esc(r2.status || '—')}</b></div>
        <div class="kv-row"><span>截止时间</span><b>${r2.due != null ? esc(fmtDue(r2.due, Date.now())) : '—'}</b></div>
        <div class="kv-row"><span>剩余</span><b class="${rel.tone}">${esc(r2.due != null && !r2.done ? rel.text : r2.done ? '已完成' : '—')}</b></div>
        <div class="kv-row"><span>优先级</span><b>${esc(r2.priority || '—')}</b></div>
        <div class="kv-row"><span>负责人</span><b>${esc(r2.owner || '—')}</b></div>
        <div class="kv-row"><span>标签</span><b>${r2.tags.length ? r2.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '—'}</b></div>
        ${r2.note ? `<div class="kv-row"><span>备注</span><b style="font-weight:450;color:var(--text-2)">${esc(r2.note)}</b></div>` : ''}
      </div>

      <div class="sec" id="remSec">
        <div class="sec-head">
          <h4>提醒</h4>
          <span class="hint">${isDefault ? '使用默认提醒' : '已自定义'}</span>
          ${isDefault ? '' : `<button class="btn sm ghost" data-k="rem-default">恢复默认</button>`}
        </div>
        <div class="chips" style="margin-bottom:8px">
          ${REMINDER_PRESETS.map((p) => `<button class="chip ${offsets.includes(p.v) ? 'active' : ''}" data-k="rem" data-v="${p.v}">${p.label}</button>`).join('')}
          <button class="chip ${offsets.length === 0 ? 'active' : ''}" data-k="rem-none">不提醒</button>
        </div>
        <p class="hint" style="margin:0 0 10px">可多选。当前：${offsets.length ? '提前 ' + offsets.slice().sort((a, b) => b - a).map(offsetLabel).join(' / ') : '不提醒'}</p>
        <div class="row tight">
          <button class="btn sm ghost" data-k="snooze" data-v="10">稍后 10 分钟</button>
          <button class="btn sm ghost" data-k="snooze" data-v="60">稍后 1 小时</button>
          <button class="btn sm ghost" data-k="snooze" data-v="tomorrow">明天 9:00</button>
        </div>
        ${snoozed ? `<p class="hint" style="margin:8px 0 0;color:var(--amber)">已设置稍后提醒：${esc(fmtShort(r2.snoozeUntil))}
          <button class="btn sm ghost" data-k="snooze-clear" style="margin-left:6px">取消</button></p>` : ''}
      </div>

      ${state.table ? `<div class="sec">
        <div class="sec-head"><h4>原始行</h4><span class="hint">来自表格，本地只读</span></div>
        <div class="raw-row">${state.table.headers.map((hd, i) => `<div><span>${esc(hd)}</span><b>${esc(r2.raw[i] ?? '')}</b></div>`).join('')}</div>
      </div>` : ''}
    `;
  };

  h.setBody(body());
  if (focusReminder) setTimeout(() => {
    const s = h.el.querySelector('#remSec');
    if (s) s.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, 80);

  h.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    const r = state.byId.get(id);
    if (!r) return;
    if (k === 'toggle') {
      toggleDone(id);
      h.setBody(body());
      refresh();
      return;
    }
    if (k === 'rem') {
      const v = Number(b.dataset.v);
      const cur = Array.isArray(r.reminders) && r.reminders.length ? [...r.reminders] : [...state.settings.defaultReminders];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort((a, b2) => b2 - a);
      setTaskReminders(id, next);
      h.setBody(body()); refresh();
      return;
    }
    if (k === 'rem-none') { setTaskReminders(id, []); h.setBody(body()); refresh(); return; }
    if (k === 'rem-default') { resetTaskReminders(id); h.setBody(body()); refresh(); return; }
    if (k === 'snooze') {
      const v = b.dataset.v;
      if (v === 'tomorrow') {
        const t = startOfDay(Date.now()) + DAY + 9 * HOUR;
        setOverride(id, { snoozeUntil: t });
      } else {
        snooze(id, Number(v));
      }
      h.setBody(body()); refresh();
      toast({ type: 'info', title: '已设置稍后提醒', text: '到时间会再次提醒你' });
      return;
    }
    if (k === 'snooze-clear') { clearSnooze(id); h.setBody(body()); refresh(); }
  });
}

/* ========================================================================== */
/* 一行内容（一个英雄）的全部岗位                                             */
/* ========================================================================== */

export function openRow(rowIndex) {
  const find = () => (state.rowCards || []).find((c) => c.rowIndex === rowIndex);
  const first = find();
  if (!first) return;
  const now = Date.now();

  const h = drawer({
    title: `<span style="font-size:15px">${esc(first.title)}</span>`,
    subtitle: [first.phase, first.release ? `上线 ${first.release}` : ''].filter(Boolean).join(' · ') || '全部岗位',
    body: '',
    footer: `<span class="hint" style="flex:1">表格由老板和各位负责人维护，这里只能勾自己负责的那块</span>
      <button class="btn ghost" data-close>关闭</button>`,
  });

  const body = () => {
    const c = find() || first;
    const raw = c.recs[0] && c.recs[0].raw;
    const roleRows = c.recs.map((r) => {
      const editable = canEdit(r);
      const rel = relTime(r.due, now);
      return `<div class="kv-row">
        <span>${esc(r.roleName)}${r.owner ? ` · ${esc(r.owner)}` : ''}</span>
        <b style="display:flex;align-items:center;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <span>${r.done ? '<span class="tag">已完成</span>' : (r.due != null ? esc(fmtDue(r.due, now)) : '—')}</span>
          ${!r.done && r.due != null ? `<span class="rel ${rel.tone}">${esc(rel.text)}</span>` : ''}
          ${editable ? `<button class="btn sm ghost" data-k="toggle" data-id="${esc(r.id)}">${r.done ? '撤销完成' : '标记完成'}</button>` : ''}
        </b>
      </div>`;
    }).join('');
    const miles = c.milestones.map((m) => `<div class="kv-row"><span>${esc(m.name)}</span><b>${esc(m.raw || '—')}</b></div>`).join('');

    return `
      <div class="kv" style="margin-bottom:14px">${roleRows}${miles}</div>
      ${state.table && raw ? `<div class="sec">
        <div class="sec-head"><h4>原始行</h4><span class="hint">来自表格，本地只读</span></div>
        <div class="raw-row">${state.table.headers.map((hd, i) => `<div><span>${esc(hd)}</span><b>${esc(raw[i] ?? '')}</b></div>`).join('')}</div>
      </div>` : ''}`;
  };

  h.setBody(body());
  h.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k="toggle"]');
    if (!b) return;
    if (!toggleDone(b.dataset.id)) {
      toast({ type: 'warn', title: '这块不是你负责的', text: '只能勾自己名下的岗位' });
      return;
    }
    h.setBody(body());
    refresh();
  });
}

/* ========================================================================== */
/* 规则编辑器                                                                 */
/* ========================================================================== */

export function openRuleEditor(ruleId) {
  const existing = ruleId ? state.rules.find((r) => r.id === ruleId) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : newRule();
  const headers = state.table ? state.table.headers : [];

  const h = drawer({
    wide: true,
    title: existing ? '编辑规则' : '新建规则',
    subtitle: '命中条件后套用样式 · 从上往下匹配',
    body: '',
    footer: `
      <button class="btn ghost" data-k="cancel">取消</button>
      <span class="spacer"></span>
      <button class="btn primary" data-k="save">${icon('check')}保存规则</button>`,
  });

  function condRow(c, i) {
    const type = (FIELDS.find((f) => f.key === c.field) || FIELDS[0]).type;
    const ops = opsFor(c.field);
    let valueHtml = '';
    if (type === 'duration') {
      valueHtml = `<div class="row tight" style="gap:4px">
        <input class="input" type="number" min="0" step="1" value="${esc(c.value ?? 0)}" data-ci="${i}" data-cf="value" style="width:64px" />
        <select class="select" data-ci="${i}" data-cf="unit" style="width:74px">
          <option value="min" ${c.unit === 'min' ? 'selected' : ''}>分钟</option>
          <option value="hour" ${c.unit === 'hour' ? 'selected' : ''}>小时</option>
          <option value="day" ${c.unit === 'day' ? 'selected' : ''}>天</option>
        </select>
      </div>`;
    } else if (type === 'date') {
      if (c.op === 'within') {
        valueHtml = `<input class="input" type="number" min="1" value="${esc(c.value ?? 7)}" data-ci="${i}" data-cf="value" placeholder="天数" />`;
      } else if (c.op === 'before' || c.op === 'after') {
        valueHtml = `<input class="input" type="date" value="${esc(c.date || fmtDate(Date.now(), 'YYYY-MM-DD'))}" data-ci="${i}" data-cf="date" />`;
      } else {
        valueHtml = `<span class="hint" style="align-self:center">无需填写</span>`;
      }
    } else if (type === 'bool') {
      valueHtml = `<select class="select" data-ci="${i}" data-cf="value">
        <option value="true" ${c.value === 'true' ? 'selected' : ''}>已完成</option>
        <option value="false" ${c.value === 'false' ? 'selected' : ''}>未完成</option>
      </select>`;
    } else if (type === 'column') {
      valueHtml = `<div class="row tight" style="gap:4px">
        <select class="select" data-ci="${i}" data-cf="col" style="width:96px">
          ${headers.map((hd, idx) => `<option value="${idx}" ${Number(c.col) === idx ? 'selected' : ''}>${esc(hd || '第' + (idx + 1) + '列')}</option>`).join('')}
        </select>
        <input class="input" value="${esc(c.value ?? '')}" data-ci="${i}" data-cf="value" placeholder="值" />
      </div>`;
    } else {
      valueHtml = `<input class="input" value="${esc(c.value ?? '')}" data-ci="${i}" data-cf="value" placeholder="值" ${['empty', 'not_empty'].includes(c.op) ? 'disabled' : ''} />`;
    }
    return `
      <div class="cond">
        <select class="select" data-ci="${i}" data-cf="field">
          ${FIELDS.map((f) => `<option value="${f.key}" ${f.key === c.field ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
        <select class="select" data-ci="${i}" data-cf="op">
          ${ops.map((o) => `<option value="${o.key}" ${o.key === c.op ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        ${valueHtml}
        <button class="icon-btn" data-k="cond-del" data-i="${i}" title="删除条件">${icon('x', 'sm')}</button>
      </div>`;
  }

  function preview() {
    const sample = sampleRecord();
    const st = resolveStyle(draft, sample, Date.now());
    const badge = st.badge || '';
    return `
      <div class="preview-card" style="${styleVars(st)}">
        <div class="pt">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${draft.style.strike ? 'text-decoration:line-through;' : ''}">${esc(sample.title)}</span>
          ${badge ? `<span class="badge" style="flex:none;--r-badge-bg:${st.badgeBg};--r-badge-fg:${st.badgeFg}">${esc(badge)}</span>` : ''}
        </div>
        <div class="ps">${esc(fmtDue(sample.due))} · 剩余 20 小时 · 进行中</div>
      </div>`;
  }

  function swatches(key, value, colors) {
    return `<div class="swatches">
      ${colors.map((c) => `<button class="swatch ${String(value).toLowerCase() === c.toLowerCase() ? 'active' : ''}" data-k="color" data-field="${key}" data-v="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <label class="swatch custom" title="自定义颜色"><input type="color" data-k="color-input" data-field="${key}" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#F04438'}" /></label>
    </div>`;
  }

  function body() {
    return `
      <div class="field">
        <label>规则名称</label>
        <input class="input" id="ruleName" value="${esc(draft.name)}" placeholder="例如：今天到期" />
      </div>

      <div class="field">
        <label>匹配方式</label>
        <div class="logic-toggle">
          <button class="${draft.logic === 'all' ? 'active' : ''}" data-k="logic" data-v="all">全部满足 (且)</button>
          <button class="${draft.logic === 'any' ? 'active' : ''}" data-k="logic" data-v="any">任一满足 (或)</button>
        </div>
      </div>

      <div class="field">
        <label>条件 <span class="opt">从上到下按顺序匹配，命中即停</span></label>
        <div class="cond-list" id="condList">${draft.conds.map((c, i) => condRow(c, i)).join('')}</div>
        <button class="btn sm ghost" data-k="cond-add" style="margin-top:8px;align-self:flex-start">${icon('plus')}添加条件</button>
      </div>

      <div class="field">
        <label>徽章文字 <span class="opt">可用 {days} {hours} {overdueDays}</span></label>
        <input class="input" id="badgeText" value="${esc(draft.style.badge || '')}" placeholder="例如：逾期 {overdueDays} 天" />
      </div>

      <div class="field"><label>背景色</label>${swatches('bg', draft.style.bg, PALETTE.bg)}</div>
      <div class="field"><label>文字色</label>${swatches('fg', draft.style.fg, PALETTE.fg)}</div>
      <div class="field"><label>左边条</label>${swatches('bar', draft.style.bar, PALETTE.bar)}</div>

      <div class="field">
        <label>其他</label>
        <label class="check-row"><input type="checkbox" data-k="strike" ${draft.style.strike ? 'checked' : ''} /> 文字加删除线（适合「已完成」）</label>
      </div>

      <div class="field">
        <label>效果预览</label>
        ${preview()}
      </div>

      ${existing ? `<p class="hint" style="margin-top:14px">修改后立即对所有任务生效，原始表格数据不会被改动。</p>` : ''}
    `;
  }

  h.setBody(body());

  h.el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'ruleName') draft.name = t.value;
    if (t.id === 'badgeText') draft.style.badge = t.value;
    if (t.dataset.ci != null && t.dataset.cf) {
      const i = Number(t.dataset.ci);
      const c = draft.conds[i];
      if (!c) return;
      if (t.dataset.cf === 'col') c.col = Number(t.value);
      else if (t.dataset.cf === 'value' && c.field === 'dueIn') c.value = Number(t.value);
      else c[t.dataset.cf] = t.value;
    }
    if (t.dataset.k === 'color-input') {
      draft.style[t.dataset.field] = t.value;
      redrawAll();
    }
  });

  h.el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.ci != null && t.dataset.cf) {
      const i = Number(t.dataset.ci);
      const c = draft.conds[i];
      if (!c) return;
      const f = t.dataset.cf;
      if (f === 'field') {
        c.field = t.value;
        const ops = opsFor(c.field);
        c.op = ops[0] ? ops[0].key : 'contains';
        c.value = c.field === 'dueIn' ? 24 : '';
        c.unit = c.field === 'dueIn' ? 'hour' : undefined;
      } else if (f === 'op') {
        c.op = t.value;
      } else if (f === 'unit') {
        c.unit = t.value;
      } else if (f === 'col') {
        c.col = Number(t.value);
      }
      redrawAll();
    }
    if (t.dataset.k === 'strike') {
      draft.style.strike = t.checked;
      redrawAll();
    }
  });

  h.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'cancel') { h.close(); return; }
    if (k === 'save') { saveRule(); return; }
    if (k === 'cond-add') {
      draft.conds.push({ field: 'dueIn', op: 'lte', value: 48, unit: 'hour' });
      redrawAll();
      return;
    }
    if (k === 'cond-del') {
      draft.conds.splice(Number(b.dataset.i), 1);
      redrawAll();
      return;
    }
    if (k === 'logic') { draft.logic = b.dataset.v; redrawAll(); return; }
    if (k === 'color') { draft.style[b.dataset.field] = b.dataset.v; redrawAll(); return; }
  });

  function redrawAll() {
    const scroll = h.el.querySelector('.drawer-body').scrollTop;
    h.setBody(body());
    h.el.querySelector('.drawer-body').scrollTop = scroll;
    const nameEl = h.el.querySelector('#ruleName');
    if (nameEl) nameEl.value = draft.name;
  }

  async function saveRule() {
    if (!draft.conds.length) {
      toast({ type: 'warn', title: '至少需要一个条件' });
      return;
    }
    draft.name = (draft.name || '').trim() || '未命名规则';
    if (existing) {
      const i = state.rules.findIndex((r) => r.id === existing.id);
      if (i >= 0) state.rules[i] = draft;
    } else {
      state.rules.push(draft);
    }
    save();
    h.close();
    toast({ type: 'ok', title: '规则已保存', text: `「${draft.name}」已生效` });
    refresh();
  }
}

export function confirmDeleteRule(rule) {
  return confirmDialog({
    title: '删除规则',
    text: `确定删除「<b>${esc(rule.name)}</b>」吗？删除后这些任务会按后面的规则或默认样式显示。`,
    confirmText: '删除',
    danger: true,
  });
}

export function confirmResetRules() {
  return confirmDialog({
    title: '恢复默认规则',
    text: '当前所有自定义规则会被 5 条默认规则替换，此操作不可撤销。',
    confirmText: '恢复默认',
    danger: true,
  });
}

/* ========================================================================== */
/* 设置                                                                       */
/* ========================================================================== */

export function openSettings(tab = 'source') {
  const h = drawer({
    wide: true,
    title: '设置',
    subtitle: '数据源 / 字段映射 / 提醒 / 外观',
    body: '',
  });

  const TABS = [
    ['source', '数据源', 'database'],
    ['mapping', '字段映射', 'table'],
    ['notify', '提醒', 'bell'],
    ['look', '外观与数据', 'palette'],
  ];

  function body() {
    return `
      <div class="tabs" style="margin:-4px 0 16px">
        ${TABS.map(([k, label, ic]) => `<button class="tab ${tab === k ? 'active' : ''}" data-k="tab" data-v="${k}">${icon(ic)}${label}</button>`).join('')}
      </div>
      <div id="tabBody">${tabBody()}</div>`;
  }

  function tabBody() {
    if (tab === 'source') return sourceTab();
    if (tab === 'mapping') return mappingTab();
    if (tab === 'notify') return notifyTab();
    return lookTab();
  }

  function sourceTab() {
    const src = state.source;
    return `
      <div class="kv">
        <div class="kv-row"><span>当前数据源</span><b>${src ? esc(src.title) : '未导入'}</b></div>
        <div class="kv-row"><span>类型</span><b>${src ? kindLabel(src.kind) : '—'}</b></div>
        <div class="kv-row"><span>上次同步</span><b>${src && src.lastSync ? esc(fmtShort(src.lastSync)) : '—'}</b></div>
        <div class="kv-row"><span>规模</span><b>${src ? `${src.rowCount || 0} 行 · ${src.colCount || 0} 列` : '—'}</b></div>
      </div>
      <div class="row" style="margin:14px 0">
        <button class="btn primary" data-k="sync" style="flex:none">${icon('refresh')}立即同步</button>
        <button class="btn ghost" data-k="import" style="flex:none">${icon('link')}更换数据源</button>
      </div>
      ${src && src.kind === 'feishu' ? `<div class="callout ok">${icon('check-circle')}<div>已保存应用凭证，刷新时会用同一份凭证重新读取；App Secret 只存在本机。</div></div>` : ''}
      ${src && src.kind === 'demo' ? `<div class="callout warn">${icon('info')}<div>当前是示例数据，不能同步。导入飞书表格后即可实时刷新。</div></div>` : ''}
      <div class="field" style="margin-top:18px">
        <label>其他操作</label>
        <div class="row">
          <button class="btn ghost" data-k="demo">使用示例数据</button>
          <button class="btn danger" data-k="clear">清空本地数据</button>
        </div>
        <p class="hint">清空只影响本机缓存，不会改动飞书表格。</p>
      </div>`;
  }

  function mappingTab() {
    if (!state.table) return `<p class="hint">还没有导入表格。</p>`;
    if (state.schedule && state.schedule.enabled) return scheduleTab();

    const { headers, rows } = state.table;
    const roleLabel = {
      title: '任务标题', due: '截止时间', status: '状态', tags: '标签',
      priority: '优先级', owner: '负责人', note: '备注', id: '唯一 ID',
    };
    return `
      <p class="hint" style="margin-top:0">选择每一列对应的含义。标题必填，其余可以留空。改完立即生效。</p>
      <div class="map-grid">
        ${Object.entries(roleLabel).map(([role, label]) => `
          <div class="field" style="margin-bottom:10px">
            <label>${label}${role === 'title' ? ' <span class="opt">必填</span>' : ''}</label>
            <select class="select" data-k="map" data-role="${role}" style="max-width:none;width:100%">
              <option value="-1">— 不使用 —</option>
              ${headers.map((hd, i) => `<option value="${i}" ${state.mapping[role] === i ? 'selected' : ''}>${esc(hd || '第 ' + (i + 1) + ' 列')}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <div class="row" style="margin:6px 0 14px">
        <button class="btn ghost" data-k="auto-map" style="flex:none">重新自动识别</button>
      </div>
      <div class="field">
        <label>预览（前 3 行）</label>
        <div class="table-wrap mini"><table class="data">
          <thead><tr>${headers.map((hd) => `<th>${esc(hd)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 3).map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  function scheduleTab() {
    const S = state.schedule;
    const headers = state.table ? state.table.headers : [];
    const colName = (i) => (i >= 0 ? `第 ${i + 1} 列` : '—');
    const colOptions = (cur, autoLabel = '自动 / 不用') => [
      `<option value="-1" ${cur < 0 ? 'selected' : ''}>${autoLabel}</option>`,
      ...headers.map((h, i) => `<option value="${i}" ${cur === i ? 'selected' : ''}>${i + 1}. ${esc(h || '未命名列')}</option>`),
    ].join('');
    return `
      <div class="callout ok" style="margin-top:0">${icon('check-circle')}<div>已识别为「排期表」：一行一个内容，按 ${S.roles.length} 个角色分组，共 ${state.records.length} 条角色任务。</div></div>
      <div class="row">
        <div class="field"><label>我的名字 <span class="opt">用于「只看我的」</span></label><input class="input" data-k="my-name" value="${esc(state.settings.myName || '')}" placeholder="例如：吴铭华" /></div>
        <div class="field"><label>档期基准日</label><input class="input" type="date" data-k="base-date" value="${esc(S.baseDate || '')}" /></div>
      </div>
      <p class="hint" style="margin-top:-6px">表里只有「10月24日」这种写法，用基准日补年份：基准日前 30 天内的算今年，跨年的自动算下一年，不会改表格。</p>
      <div class="switch-row">
        <div class="txt"><b>负责人向下填充</b><span>合并单元格只有左上角那格有值，打开后按上一行补全（不改表格）</span></div>
        ${switchHtml(state.settings.fillDown, 'data-k="fill-down"')}
      </div>

      <div class="field" style="margin-top:6px">
        <label>内容 / 期数 / 上线日列 <span class="opt">自动识别不对时手动指</span></label>
        <div class="row">
          <div class="field"><label style="font-size:11px">内容列</label><select class="select" data-k="sched-col" data-key="titleCol" style="max-width:none;width:100%">${colOptions(S.titleCol)}</select></div>
          <div class="field"><label style="font-size:11px">期数列</label><select class="select" data-k="sched-col" data-key="phaseCol" style="max-width:none;width:100%">${colOptions(S.phaseCol)}</select></div>
          <div class="field"><label style="font-size:11px">上线日列</label><select class="select" data-k="sched-col" data-key="releaseCol" style="max-width:none;width:100%">${colOptions(S.releaseCol)}</select></div>
        </div>
      </div>

      <div class="field">
        <label>角色分组 <span class="opt">可改名、改负责人列、点日期列开关</span></label>
        ${S.roles.map((r, i) => `
          <div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px">
            <div class="row" style="align-items:center;gap:6px">
              <input class="input sm" data-k="role-name" data-i="${i}" value="${esc(r.name)}" style="max-width:110px" />
              <select class="select" data-k="role-owner" data-key="${r.key}" style="max-width:none;flex:1;min-width:140px">
                <option value="-1" ${r.ownerCol < 0 ? 'selected' : ''}>没有负责人列</option>
                ${headers.map((h, ci) => `<option value="${ci}" ${r.ownerCol === ci ? 'selected' : ''}>${ci + 1}. ${esc(h || '未命名列')}</option>`).join('')}
              </select>
              <b style="font-weight:450;color:var(--text-3);font-size:11.5px;white-space:nowrap">${r.dateCols.length} 个日期列</b>
            </div>
            <div class="chips" style="margin-top:7px">
              ${headers.map((h, ci) => `<button class="chip ${r.dateCols.includes(ci) ? 'active' : ''}" data-k="role-date" data-key="${r.key}" data-col="${ci}" title="第 ${ci + 1} 列">${esc(h || `列 ${ci + 1}`)}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn ghost" data-k="redetect" style="flex:none">重新自动识别</button>
        <button class="btn ghost" data-k="schedule-off" style="flex:none">改用普通任务表</button>
      </div>
      <p class="hint" style="margin-top:10px">改完立刻生效并存在本地；「重新自动识别」会覆盖手动改过的列。</p>`;
  }

  function notifyTab() {
    const perm = permission();
    const permText = perm === 'granted' ? '已允许系统通知' : perm === 'denied' ? '系统通知被拒绝（需要在浏览器设置里打开）' : '尚未允许系统通知';
    return `
      <div class="callout ${perm === 'granted' ? 'ok' : 'warn'}">${icon('bell')}<div>${permText}。${perm !== 'granted' ? '允许后才能收到 Windows 弹窗提醒。' : '关掉页面后仍会由系统通知提醒（页面需保持打开）。'}</div></div>
      <div class="row" style="margin:12px 0 18px">
        <button class="btn primary" data-k="perm" style="flex:none;${perm === 'granted' ? 'display:none' : ''}">开启系统通知</button>
        <button class="btn ghost" data-k="test">发送测试提醒</button>
      </div>

      <div class="field">
        <label>默认提醒时间 <span class="opt">未单独设置的任务使用</span></label>
        <div class="chips">
          ${REMINDER_PRESETS.map((p) => `<button class="chip ${state.settings.defaultReminders.includes(p.v) ? 'active' : ''}" data-k="def-rem" data-v="${p.v}">${p.label}</button>`).join('')}
        </div>
      </div>

      <div class="switch-row">
        <div class="txt"><b>提示音</b><span>提醒时播放两声轻提示</span></div>
        ${switchHtml(state.settings.sound, 'data-k="sound"')}
      </div>
      <div class="switch-row">
        <div class="txt"><b>每日早报</b><span>每天早上汇总当天到期和逾期任务</span></div>
        <input class="input" type="time" data-k="digest" value="${esc(state.settings.dailyDigest || '')}" style="width:120px;height:30px" />
      </div>
      <div class="switch-row">
        <div class="txt"><b>显示已完成任务</b><span>关闭后列表和看板里只剩未完成</span></div>
        ${switchHtml(state.settings.showDone, 'data-k="show-done"')}
      </div>`;
  }

  function lookTab() {
    return `
      <div class="field">
        <label>主题</label>
        <div class="seg">
          <button class="${state.settings.theme !== 'dark' ? 'active' : ''}" data-k="theme" data-v="light">${icon('sun', 'sm')}浅色</button>
          <button class="${state.settings.theme === 'dark' ? 'active' : ''}" data-k="theme" data-v="dark">${icon('moon', 'sm')}深色</button>
        </div>
      </div>
      <div class="field">
        <label>紧凑模式 <span class="opt">一屏显示更多任务</span></label>
        ${switchHtml(state.settings.density === 'compact', 'data-k="density"')}
      </div>
      <div class="field" style="margin-top:20px">
        <label>数据</label>
        <div class="row">
          <button class="btn ghost" data-k="export">${icon('download')}导出备份 JSON</button>
          <button class="btn danger" data-k="clear">${icon('trash')}清空本地数据</button>
        </div>
      </div>
      <div class="callout" style="margin-top:20px">${icon('info')}<div>所有配置、完成状态和规则都保存在本机 <code>data/state.json</code>，不会上传到任何服务器。App Secret 也只保存在本机。</div></div>
      <p class="hint" style="margin-top:16px">日程舱 v1.0 · 飞书表格 / 多维表格 / 粘贴导入</p>`;
  }

  h.setBody(body());

  h.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;

    if (k === 'tab') { tab = b.dataset.v; h.setBody(body()); return; }
    if (k === 'import') { window.__openImport && window.__openImport(); return; }
    if (k === 'sync') { window.__syncNow && window.__syncNow(); return; }
    if (k === 'demo') {
      const ok = await confirmDialog({ title: '使用示例数据', text: '当前数据将被示例数据替换（本地已完成标记会保留）。', confirmText: '替换' });
      if (!ok) return;
      loadDemo(); refresh(); h.setBody(body());
      toast({ type: 'ok', title: '已载入示例数据' });
      return;
    }
    if (k === 'clear') {
      const ok = await confirmDialog({ title: '清空本地数据', text: '将删除本地缓存的表格、规则外的完成状态与提醒记录。飞书表格本身不受影响。', confirmText: '清空', danger: true });
      if (!ok) return;
      clearAll(); refresh(); h.setBody(body());
      toast({ type: 'ok', title: '已清空' });
      return;
    }
    if (k === 'auto-map') {
      if (!state.table) return;
      setMapping(autoMap(state.table.headers, state.table.rows));
      refresh(); h.setBody(body());
      toast({ type: 'ok', title: '已重新识别字段' });
      return;
    }
    if (k === 'redetect') {
      if (!state.table) return;
      const det = detectSchedule(state.table.headers, state.table.rows);
      if (!det) { toast({ type: 'warn', title: '没识别出角色分组', text: '这张表可能不是「负责人 + 日期」重复排期结构' }); return; }
      state.schedule = det;
      rebuild(); save(); refresh(); h.setBody(body());
      toast({ type: 'ok', title: '已重新识别', text: `${det.roles.length} 个角色 · ${state.records.length} 条任务` });
      return;
    }
    if (k === 'schedule-off') {
      state.schedule = { ...state.schedule, enabled: false };
      rebuild(); save(); refresh(); h.setBody(body());
      toast({ type: 'info', title: '已切换为普通任务表' });
      return;
    }
    if (k === 'perm') {
      const r = await requestPermission();
      toast({ type: r === 'granted' ? 'ok' : 'warn', title: r === 'granted' ? '系统通知已开启' : '未获得通知权限' });
      h.setBody(body());
      return;
    }
    if (k === 'test') { fireTest(); return; }
    if (k === 'def-rem') {
      const v = Number(b.dataset.v);
      const cur = state.settings.defaultReminders;
      state.settings.defaultReminders = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort((x, y) => y - x);
      save(); h.setBody(body());
      return;
    }
    if (k === 'sound') { state.settings.sound = !state.settings.sound; save(); h.setBody(body()); return; }
    if (k === 'show-done') { state.settings.showDone = !state.settings.showDone; save(); refresh(); h.setBody(body()); return; }
    if (k === 'fill-down') { state.settings.fillDown = !state.settings.fillDown; rebuild(); save(); refresh(); h.setBody(body()); return; }
    if (k === 'role-date') {
      if (!toggleRoleDateCol(b.dataset.key, Number(b.dataset.col))) {
        toast({ type: 'warn', title: '至少留一个日期列', text: '这个岗位至少要有一列日期，否则没有截止时间' });
        return;
      }
      refresh();
      h.setBody(body());
      return;
    }
    if (k === 'theme') { state.settings.theme = b.dataset.v; applyTheme(); save(); h.setBody(body()); refresh(); return; }
    if (k === 'density') {
      state.settings.density = state.settings.density === 'compact' ? 'cozy' : 'compact';
      applyDensity(); save(); h.setBody(body()); return;
    }
    if (k === 'export') {
      download('schedule-deck-backup.json', exportJSON());
      toast({ type: 'ok', title: '已导出备份' });
      return;
    }
  });

  h.el.addEventListener('change', (e) => {
    const t = e.target;
    const k = t.dataset.k;
    if (k === 'map') {
      setMapping({ [t.dataset.role]: Number(t.value) });
      refresh();
      toast({ type: 'ok', title: '字段映射已更新', text: `当前共 ${state.records.length} 条任务` });
    }
    if (k === 'digest') { state.settings.dailyDigest = t.value; save(); }
    if (k === 'base-date') {
      state.schedule.baseDate = t.value;
      rebuild(); save(); refresh(); h.setBody(body());
      toast({ type: 'ok', title: '档期基准日已更新', text: `按 ${t.value} 补全年份` });
    }
    if (k === 'my-name') {
      state.settings.myName = t.value.trim();
      save(); refresh(); h.setBody(body());
    }
    if (k === 'sched-col') {
      setScheduleCol(t.dataset.key, Number(t.value));
      refresh(); h.setBody(body());
      toast({ type: 'ok', title: '列已更新', text: `当前共 ${state.records.length} 条角色任务` });
    }
    if (k === 'role-owner') {
      setRoleOwnerCol(t.dataset.key, Number(t.value));
      refresh(); h.setBody(body());
    }
    if (k === 'role-name') {
      const i = Number(t.dataset.i);
      const role = state.schedule.roles[i];
      if (role) {
        role.name = t.value.trim() || role.name;
        rebuild(); save(); refresh(); h.setBody(body());
      }
    }
  });
}

function kindLabel(kind) {
  return { feishu: '飞书表格（应用凭证）', paste: '粘贴导入', demo: '示例数据', csv: 'CSV 链接' }[kind] || kind || '—';
}

export function applyTheme() {
  const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
}

export function applyDensity() {
  document.documentElement.dataset.density = state.settings.density === 'compact' ? 'compact' : 'cozy';
}

/* ========================================================================== */
/* 提醒中心                                                                   */
/* ========================================================================== */

export function openReminders() {
  const h = drawer({ title: '提醒中心', subtitle: '到点会弹系统通知 + 应用内提示', body: '' });
  const body = () => {
    const perm = permission();
    const up = upcoming(16);
    const recent = recentFired(6);
    return `
      ${perm !== 'granted' ? `<div class="callout warn">${icon('bell')}<div style="flex:1">系统通知还没开，到点只会在应用内提示。</div><button class="btn sm primary" data-k="perm">开启</button></div>` : ''}
      <div class="sec">
        <div class="sec-head"><h4>即将提醒</h4><span class="hint">${up.length} 条</span></div>
        ${up.length ? `<div class="feed">${up.map((u) => `
          <div class="feed-item" data-k="go" data-id="${esc(u.rec.id)}" style="cursor:pointer">
            <div class="feed-date"><b>${fmtDate(u.at, 'HH:mm')}</b><span>${fmtDate(u.at, 'MM/DD')}</span></div>
            <div class="feed-main">
              <div class="feed-title">${esc(u.rec.title)}</div>
              <div class="feed-sub">${esc(u.label)} · ${esc(fmtDue(u.rec.due))}</div>
            </div>
            ${icon('chevron-right', 'sm')}
          </div>`).join('')}</div>` : `<p class="hint">近期没有待触发的提醒。</p>`}
      </div>
      <div class="sec">
        <div class="sec-head"><h4>最近提醒</h4></div>
        ${recent.length ? `<div class="feed">${recent.map((r) => `
          <div class="feed-item">
            <div class="feed-date"><b>${fmtDate(r.at, 'HH:mm')}</b><span>${fmtDate(r.at, 'MM/DD')}</span></div>
            <div class="feed-main"><div class="feed-title">${esc(r.rec.title)}</div><div class="feed-sub">已通知</div></div>
          </div>`).join('')}</div>` : `<p class="hint">还没有触发过提醒。</p>`}
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn ghost" data-k="settings">${icon('settings')}提醒设置</button>
        <button class="btn ghost" data-k="test">发送测试</button>
      </div>`;
  };
  h.setBody(body());
  h.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'perm') { await requestPermission(); h.setBody(body()); return; }
    if (k === 'test') { fireTest(); return; }
    if (k === 'settings') { h.close(); openSettings('notify'); return; }
    if (k === 'go') { h.close(); openTask(b.dataset.id); }
  });
}

/* ========================================================================== */
/* 导入                                                                       */
/* ========================================================================== */

const FEISHU_STEPS = `
  <div class="steps">
    <div class="step"><span>打开 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">飞书开放平台 → 创建企业自建应用</a>，名字随意（例如「日程舱」）。</span></div>
    <div class="step"><span>在「添加应用能力」里打开 <b>机器人</b>。</span></div>
    <div class="step"><span>「权限管理」只加这三个：<code>sheets:spreadsheet:readonly</code>（电子表格）、<code>bitable:app:readonly</code>（多维表格）、<code>wiki:wiki:readonly</code>（知识库链接）。<br /><b>不要加</b> <code>drive:drive:readonly</code>——那是整个云盘的只读权限，需要管理员审批，本应用用不到。</span></div>
    <div class="step"><span>「版本管理与发布」创建版本并发布，可用范围勾上你自己。</span></div>
    <div class="step"><span>回到飞书表格页右上角「···」→「添加文档应用」→ 选择刚建的应用 → 可阅读。</span></div>
    <div class="step"><span>把表格链接、App ID、App Secret 填到下面，点「连接并导入」。</span></div>
  </div>`;

export function openImport(tab = 'oauth', { asNew = false } = {}) {
  let pollTimer = 0;
  // 新开一条数据源还是替换当前这条
  const push = (data) => applyImport(data, { asNew });
  const m = modal({
    title: asNew ? '新增数据源' : '导入飞书表格',
    subtitle: asNew ? '再挂一张表，侧栏可以随时切换' : '扫码登录最省事；也可以用应用凭证或直接粘贴',
    body: '',
    footer: '',
    onClose: () => clearInterval(pollTimer),
  });

  let lastPreview = null;

  function body() {
    return `
      <div class="tabs" style="margin:-6px 0 16px">
        <button class="tab ${tab === 'oauth' ? 'active' : ''}" data-k="tab" data-v="oauth">${icon('user')}扫码登录</button>
        <button class="tab ${tab === 'feishu' ? 'active' : ''}" data-k="tab" data-v="feishu">${icon('key')}应用凭证</button>
        <button class="tab ${tab === 'paste' ? 'active' : ''}" data-k="tab" data-v="paste">${icon('clipboard')}粘贴 / 文件</button>
        <button class="tab ${tab === 'demo' ? 'active' : ''}" data-k="tab" data-v="demo">${icon('sparkles')}示例</button>
      </div>
      <div id="tabBody">${tabBody()}</div>`;
  }

  function tabBody() {
    if (tab === 'oauth') return oauthBody();
    if (tab === 'feishu') return feishuBody();
    if (tab === 'paste') return pasteBody();
    return demoBody();
  }

  function oauthBody() {
    const src = state.source || {};
    return `
      <div class="callout" style="margin:0 0 14px;background:var(--accent-soft);color:var(--accent)">
        ${icon('info')}<div>用你自己的飞书账号授权，APP 以你的身份读表：<b>不需要</b>「添加文档应用」，也不用把应用加进知识库 / 共享空间。</div>
      </div>
      <div class="row">
        <div class="field"><label>App ID</label><input class="input" id="oaAppId" placeholder="cli_xxxxxxxx" autocomplete="off" /></div>
        <div class="field"><label>App Secret</label><input class="input" id="oaSecret" type="password" placeholder="留空则使用已保存的" autocomplete="off" /></div>
      </div>
      <div class="row" style="align-items:center;margin-bottom:4px">
        <button class="btn primary" data-k="oauth-login" style="flex:none">${icon('user')}用飞书登录</button>
        <span class="hint" id="oaStatus" style="flex:1">正在检查登录状态…</span>
      </div>
      <div class="callout ok" id="oaUser" hidden style="margin:10px 0"></div>
      <div class="field" style="margin-top:14px">
        <label>表格链接 <span class="opt">支持 /wiki/、/sheets/、/base/</span></label>
        <input class="input" id="oaUrl" placeholder="https://xxx.feishu.cn/wiki/xxxx?sheet=xxxx" value="${esc(src.kind === 'feishu' ? src.url : '')}" />
      </div>
      <div class="row" style="align-items:center">
        <button class="btn primary" data-k="oauth-import" style="flex:none" disabled>${icon('download')}读取这张表</button>
        <span class="hint" style="flex:1">登录成功后按钮才会亮</span>
      </div>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text-2);padding:6px 0">第一次用？点开看配置（一次就好）</summary>
        <div class="steps" style="margin-top:8px">
          <div class="step"><span>开发者后台 → 你的应用 →「安全设置」→ 重定向 URL，添加 <code>http://127.0.0.1:17899/callback</code></span></div>
          <div class="step"><span>「权限管理」加 <code>offline_access</code>、<code>sheets:spreadsheet:readonly</code>、<code>wiki:wiki:readonly</code>（用多维表格再加 <code>bitable:app:readonly</code>）。</span></div>
          <div class="step"><span>填上面的 App ID / Secret，点「用飞书登录」；浏览器里扫码或确认授权。</span></div>
          <div class="step"><span>回到这里点「读取这张表」即可，之后刷新会自动续期。</span></div>
        </div>
      </details>`;
  }

  function feishuBody() {
    const src = state.source || {};
    return `
      <div class="field">
        <label>表格链接 <span class="opt">支持 /wiki/、/sheets/、/base/ 链接</span></label>
        <input class="input" id="impUrl" placeholder="https://xxx.feishu.cn/wiki/xxxx?sheet=xxxx" value="${esc(src.kind === 'feishu' ? src.url : '')}" />
      </div>
      <div class="row">
        <div class="field"><label>App ID</label><input class="input" id="impAppId" placeholder="cli_xxxxxxxx" autocomplete="off" /></div>
        <div class="field"><label>App Secret</label><input class="input" id="impSecret" type="password" placeholder="只保存在本机" autocomplete="off" /></div>
      </div>
      <div class="row" style="align-items:center;margin-bottom:2px">
        <button class="btn primary" data-k="connect" style="flex:none">${icon('link')}连接并导入</button>
        <span class="hint" id="impStatus" style="flex:1">首次使用需要先建一个自建应用（约 5 分钟）</span>
      </div>
      <div class="callout warn" style="margin-top:14px">${icon('info')}<div>公开分享链接不能直接读取——飞书所有读接口都需要应用凭证。用下面的 6 步建一次应用，之后就能一键同步。<br />只需要「表格 / 多维表格」的只读权限，<b>不需要</b> <code>drive:drive:readonly</code>（整个云盘只读，才需要管理员审批）。</div></div>
      <details style="margin-top:10px" ${src.kind === 'feishu' ? '' : 'open'}>
        <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text-2);padding:6px 0">第一次配置？展开 6 步操作</summary>
        <div style="padding:8px 0 4px">${FEISHU_STEPS}</div>
      </details>`;
  }

  function pasteBody() {
    return `
      <div class="field">
        <label>从飞书表格复制，直接粘贴到这里 <span class="opt">支持 Tab 分隔 / CSV</span></label>
        <textarea class="textarea" id="pasteBox" style="min-height:150px" placeholder="任务&#9;截止时间&#9;状态&#9;标签&#9;优先级&#9;负责人&#9;备注
提交季度复盘报告&#9;2026-10-21 18:00&#9;进行中&#9;工作/汇报&#9;高&#9;我&#9;需要财务数据"></textarea>
        <p class="hint">第一行会被当作表头。也可以在下面选择 .csv / .tsv 文件。</p>
      </div>
      <div class="row">
        <button class="btn ghost" data-k="parse" style="flex:none">${icon('search')}解析预览</button>
        <input type="file" id="pasteFile" accept=".csv,.tsv,.txt" style="display:none" />
        <button class="btn ghost" data-k="file" style="flex:none">${icon('upload')}选择文件</button>
        <button class="btn primary" data-k="import-paste" style="flex:none" disabled>${icon('check')}导入</button>
      </div>
      <div id="pastePreview" style="margin-top:14px"></div>`;
  }

  function demoBody() {
    return `
      <div class="empty" style="padding:30px 10px">
        <div class="empty-icon">${icon('sparkles')}</div>
        <h3>先用示例数据试试</h3>
        <p>15 条带截止时间的示例任务，可以完整体验提醒、筛选和规则配色。导入真实表格后会自动替换。</p>
        <div class="actions"><button class="btn primary" data-k="demo">载入示例数据</button></div>
      </div>`;
  }

  m.setBody(body());

  async function prefillOAuth() {
    try {
      const j = await (await fetch('/api/config', { cache: 'no-store' })).json();
      const idEl = m.el.querySelector('#oaAppId');
      const secEl = m.el.querySelector('#oaSecret');
      if (idEl && !idEl.value && j.appId) idEl.value = j.appId;
      if (secEl && j.hasSecret) secEl.placeholder = '已保存，留空即可';
    } catch { /* ignore */ }
  }

  async function refreshOAuthUI() {
    const statusEl = m.el.querySelector('#oaStatus');
    const userEl = m.el.querySelector('#oaUser');
    const btn = m.el.querySelector('[data-k="oauth-import"]');
    if (!statusEl) return false;
    try {
      const j = await (await fetch('/api/oauth/status', { cache: 'no-store' })).json();
      if (j.loggedIn) {
        statusEl.textContent = '已登录';
        if (userEl) {
          userEl.hidden = false;
          userEl.innerHTML = `${icon('check-circle')}<div>已登录为 <b>${esc((j.user && j.user.name) || '飞书用户')}</b>，读取权限跟随你本人</div>`;
        }
        if (btn) btn.disabled = false;
        if (j.user && j.user.name && !state.settings.myName) {
          state.settings.myName = j.user.name;
          save();
          refresh();
        }
        return true;
      }
      statusEl.textContent = j.callbackReady ? '未登录' : '未登录（回调端口 17899 被占用）';
      if (btn) btn.disabled = true;
      return false;
    } catch {
      statusEl.textContent = '无法连接本地服务';
      return false;
    }
  }

  function startLoginPoll() {
    clearInterval(pollTimer);
    let ticks = 0;
    pollTimer = setInterval(async () => {
      ticks += 1;
      const ok = await refreshOAuthUI();
      if (ok || ticks > 90) clearInterval(pollTimer);
    }, 2000);
  }

  prefillOAuth();
  refreshOAuthUI();

  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;

    if (k === 'tab') {
      tab = b.dataset.v;
      m.setBody(body());
      if (tab === 'oauth') { prefillOAuth(); refreshOAuthUI(); }
      return;
    }

    if (k === 'oauth-login') {
      const appIdEl = m.el.querySelector('#oaAppId');
      const secretEl = m.el.querySelector('#oaSecret');
      const urlEl = m.el.querySelector('#oaUrl');
      const appId = appIdEl ? appIdEl.value.trim() : '';
      const appSecret = secretEl ? secretEl.value.trim() : '';
      const url = urlEl ? urlEl.value.trim() : '';
      if (!appId) { toast({ type: 'warn', title: '先填 App ID' }); return; }
      setBusy(b, true, '准备授权…');
      try {
        const res = await fetch('/api/oauth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId, appSecret, url }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || '发起登录失败');
        const w = window.open(j.authUrl, 'feishu_oauth', 'width=560,height=720');
        if (!w) {
          const s = m.el.querySelector('#oaStatus');
          if (s) s.innerHTML = `弹窗被拦截，<a href="${esc(j.authUrl)}" target="_blank" rel="noreferrer">点这里打开授权页</a>`;
        }
        startLoginPoll();
      } catch (err) {
        toast({ type: 'err', title: '登录失败', text: err.message, duration: 9000 });
      } finally {
        setBusy(b, false);
      }
      return;
    }

    if (k === 'oauth-import') {
      const urlEl = m.el.querySelector('#oaUrl');
      const url = urlEl ? urlEl.value.trim() : '';
      if (!url) { toast({ type: 'warn', title: '先粘贴表格链接' }); return; }
      setBusy(b, true, '读取中…');
      try {
        const res = await fetch('/api/oauth/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || '读取失败');
        push(j.data);
        m.close();
        document.getElementById('searchInput').value = '';
        refresh();
        toast({ type: 'ok', title: '已用你的身份读取', text: `${j.data.rows.length} 行 · ${j.data.source.title || ''}` });
      } catch (err) {
        toast({ type: 'err', title: '读取失败', text: err.message, duration: 10000 });
      } finally {
        setBusy(b, false);
      }
      return;
    }

    if (k === 'connect') {
      const url = m.el.querySelector('#impUrl').value.trim();
      const appId = m.el.querySelector('#impAppId').value.trim();
      const appSecret = m.el.querySelector('#impSecret').value.trim();
      const status = m.el.querySelector('#impStatus');
      if (!url) { toast({ type: 'warn', title: '请先粘贴表格链接' }); return; }
      setBusy(b, true, '连接中…');
      status.textContent = '正在换取 token 并读取表格…';
      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, appId: appId || undefined, appSecret: appSecret || undefined }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || '导入失败');
        push(json.data);
        m.close();
        document.getElementById('searchInput').value = '';
        refresh();
        toast({ type: 'ok', title: '导入成功', text: `${json.data.rows.length} 行 · ${json.data.headers.length} 列 · ${json.data.source.title || ''}` });
      } catch (err) {
        status.textContent = '';
        toast({ type: 'err', title: '导入失败', text: err.message, duration: 9000 });
      } finally {
        setBusy(b, false);
      }
      return;
    }

    if (k === 'demo') {
      loadDemo();
      m.close();
      refresh();
      toast({ type: 'ok', title: '已载入示例数据' });
      return;
    }

    if (k === 'parse') {
      lastPreview = parsePasted(m);
      return;
    }

    if (k === 'file') {
      m.el.querySelector('#pasteFile').click();
      return;
    }

    if (k === 'import-paste') {
      if (!lastPreview) lastPreview = parsePasted(m);
      if (!lastPreview) return;
      push({
        headers: lastPreview.headers,
        rows: lastPreview.rows,
        source: { kind: 'paste', title: `粘贴导入 · ${fmtDate(Date.now(), 'MM-DD HH:mm')}`, url: '', mode: 'paste' },
      });
      m.close();
      document.getElementById('searchInput').value = '';
      refresh();
      toast({ type: 'ok', title: '导入成功', text: `${lastPreview.rows.length} 行数据` });
    }
  });

  m.el.addEventListener('change', (e) => {
    if (e.target.id === 'pasteFile') {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const box = m.el.querySelector('#pasteBox');
        if (box) box.value = String(reader.result || '');
        lastPreview = parsePasted(m);
      };
      reader.readAsText(f, 'utf-8');
    }
  });

  function parsePasted(m2) {
    const box = m2.el.querySelector('#pasteBox');
    const raw = box ? box.value : '';
    if (!raw.trim()) { toast({ type: 'warn', title: '还没有粘贴内容' }); return null; }
    const { headers, rows } = parseDelimited(raw);
    const prev = m2.el.querySelector('#pastePreview');
    if (prev) {
      prev.innerHTML = `
        <div class="hint" style="margin-bottom:6px">识别到 <b>${headers.length}</b> 列 · <b>${rows.length}</b> 行数据</div>
        <div class="table-wrap" style="max-height:220px;overflow:auto">
          <table class="data"><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 5).map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </div>`;
    }
    const btn = m2.el.querySelector('[data-k="import-paste"]');
    if (btn) btn.disabled = !headers.length || !rows.length;
    return { headers, rows };
  }
}
