# 日程舱 · ScheduleDeck

把飞书表格当作任务源，做成一个带 **DDL 自动配色、提醒、筛选、自定义规则** 的本地桌面应用。

- 前端：原生 HTML/CSS/ES Module，无构建步骤、无第三方依赖
- 后端：Node.js 原生 `http`，负责飞书接口代理与本地存档
- 外壳：C# (WinForms) 启动器，托盘常驻 + 独立应用窗口，打包成 `日程舱.exe`

## 直接使用

发行版在 `dist\日程舱\`，双击 `日程舱.exe` 即可。

首次启动会载入 15 条示例任务，点右上角「导入表格」接入真实飞书表格。

## 功能

| 模块 | 说明 |
| --- | --- |
| 数据源 | 飞书电子表格 / 多维表格 / 知识库链接；粘贴 TSV/CSV；示例数据 |
| 视图 | 总览、任务清单（按逾期/今天/明天/本周分组）、日历、表格、规则中心 |
| 筛选 | 搜索标题/标签/备注/负责人；状态、标签、优先级、时间桶、排序 |
| 提醒 | 默认提前 1 天 / 2 小时 / 15 分钟，可逐任务覆盖；Windows 通知 + 声音 + 稍后提醒；每日早报 |
| DIY 规则 | 条件（剩余时间 / 截止日期 / 状态 / 标签 / 任意列）+ 颜色 + 徽章 + 删除线，从上往下匹配 |
| 本地状态 | 完成标记、提醒、规则、映射存入 `data\state.json`，刷新不丢 |

默认规则：

1. 已完成 → 置灰 + 删除线
2. 剩余时间 < 0 → 红底红字，徽章「逾期 N 天 / N 小时」
3. 剩余 ≤ 24 小时 → 橙
4. 剩余 ≤ 3 天 → 黄
5. 剩余 ≤ 7 天 → 浅蓝

## 飞书接入

## 飞书接入

两种方式，选一种即可。

### 方式一：扫码登录（推荐，免文档授权）

用你自己的账号授权，APP 以你的身份读表，不需要「添加文档应用」，也不用加知识库 / 空间成员。

1. 开发者后台 → 应用 →「安全设置」→ 重定向 URL：添加 `http://127.0.0.1:17899/callback`
2. 「权限管理」加 `offline_access`、`sheets:spreadsheet:readonly`、`wiki:wiki:readonly`
   （多维表格再加 `bitable:app:readonly`）
3. APP「导入表格 → 扫码登录」填 App ID / Secret，点登录，浏览器扫码授权
4. 授权后粘贴表格链接即可读取

`user_access_token` 约 2 小时，`refresh_token` 约 30 天（靠 `offline_access`），过期自动刷新；
回调固定在本机 `17899` 端口，只监听 127.0.0.1。

### 方式二：应用凭证（tenant token）

需要一次性建一个企业自建应用，并把应用加为文档协作者：

1. <https://open.feishu.cn/app> 创建企业自建应用
2. 「添加应用能力」→ 机器人
3. 「权限管理」只加这三个
   - `sheets:spreadsheet:readonly`（电子表格）
   - `bitable:app:readonly`（多维表格，按需）
   - `wiki:wiki:readonly`（知识库链接，按需）
   - **不要**加 `drive:drive:readonly`：整个云盘只读属于高级权限，需要管理员审批，本应用不调用任何 Drive 接口
4. 「版本管理与发布」创建版本并发布，可用范围包含自己
5. 文档页 `···` → `添加文档应用` → 选择应用 → 可阅读
   （知识库：知识库设置 → 成员设置 → 加入含该应用的群）
6. 在应用里粘贴链接 + App ID + App Secret

支持链接：

- `https://xxx.feishu.cn/wiki/<node>?sheet=<sheet_id>`（知识库里的表格，先 `get_node` 换 obj_token）
- `https://xxx.feishu.cn/sheets/<spreadsheet_token>?sheet=<sheet_id>`
- `https://xxx.feishu.cn/base/<app_token>?table=<table_id>`

凭证保存在 `data\config.json`，只在本机；接口调用由本地 Node 服务转发，前端不接触 secret。

## 开发

```powershell
cd schedule-deck
node server.js --open          # http://127.0.0.1:17890
```

自检脚本（需要本机 Chrome，走 CDP）：

```powershell
node tools\shoot.js            # 12 张整页截图 + 控制台错误
node tools\interact.js         # 勾选持久化 / 粘贴导入 / 新建规则
```

## 打包

### 单文件版（成品）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\build-single.ps1
```

输出 `..\打包成品\日程舱.exe`（约 34 MB，仓库外）。exe 内嵌 `runtime\node.exe`、`web\`、`server.js`，首次运行自解压到
`%LOCALAPPDATA%\ScheduleDeck\app-<构建时间戳>\`，之后直接复用；旧版本目录下次启动自动清理。

- 数据目录：优先 exe 同级的 `data\`，不可写时退回 `%LOCALAPPDATA%\ScheduleDeck\data\`
- Chrome 配置：`%LOCALAPPDATA%\ScheduleDeck\browser\`
- 每次重新打包时间戳会变，旧解压目录自动删除

### 文件夹版（调试用）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\build.ps1
```

流程：生成多尺寸 `app.ico` → `csc` 编译启动器 → 组装 `dist\日程舱\`（含 `runtime\node.exe`）。

## 目录

```
schedule-deck/
├─ server.js          本地服务：静态页 + /api/import /api/sync /api/state
├─ feishu.js          飞书鉴权、wiki 解析、表格 / 多维表格读取、错误码翻译
├─ web/
│  ├─ index.html      图标 sprite + 外壳
│  ├─ styles.css      设计系统（浅色 / 深色 / 紧凑）
│  └─ js/  util · store · rules · reminders · kit · ui · panels · app
├─ launcher/Program.cs 托盘 + 独立窗口启动器
├─ build/             图标、编译、打包脚本
└─ tools/             CDP 截图 / 交互自检
```

## 已知限制

- 应用窗口依赖 Chrome 或 Edge；都没有时会退回默认浏览器
- 提醒依赖页面运行：窗口关闭后不再提醒，重新打开会补发 30 分钟内错过的提醒
- 飞书表格首行会被当作表头；列名不规范时可在「设置 → 字段映射」里手动指定
- 单次读取按表格声明行列取数，超大表（>5000 行）会截断
- 写回飞书未实现（只读）
