using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("日程舱")]
[assembly: AssemblyDescription("飞书表格驱动的日程与 DDL 提醒")]
[assembly: AssemblyProduct("日程舱 ScheduleDeck")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace ScheduleDeck
{
    internal static class Program
    {
        private static NotifyIcon _tray;
        private static System.Windows.Forms.Timer _updateTimer;
        private static System.Windows.Forms.Timer _applyTimer;
        private static Process _node;
        private static string _baseUrl;
        private static string _appDir;
        private static string _dataDir;
        private static string _profileDir;
        private static Icon _appIcon;
        private static bool _noWindow;
        private static bool _packaged;
        private static bool _autoInstall;

        [STAThread]
        private static void Main(string[] args)
        {
            _noWindow = Array.IndexOf(args, "--no-window") >= 0;
            _autoInstall = Array.IndexOf(args, "--auto-update") >= 0;

            bool created;
            using (var mutex = new Mutex(true, "ScheduleDeck.App.v1", out created))
            {
                if (!created)
                {
                    OpenExisting();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                try
                {
                    Prepare();
                    StartServer();
                    SetupTray();
                    if (!_noWindow) OpenWindow();
                    Application.ApplicationExit += delegate { StopServer(); };
                    Application.Run();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "启动失败：" + ex.Message + Environment.NewLine + Environment.NewLine +
                        "日志：" + Path.Combine(_dataDir == null ? AppDomain.CurrentDomain.BaseDirectory : _dataDir, "server.log"),
                        "日程舱", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    StopServer();
                }
            }
        }

        /* ---------------------------------------------------------------- 准备 */

        private static void Prepare()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream payload = asm.GetManifestResourceStream("Payload.zip");

            if (payload != null)
            {
                _packaged = true;
                _appDir = ExtractPayload(payload);
            }
            else
            {
                _appDir = exeDir;
            }

            _dataDir = ResolveDataDir(exeDir);
            Directory.CreateDirectory(_dataDir);

            _profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ScheduleDeck", "browser");
            Directory.CreateDirectory(_profileDir);
        }

        private static string ResolveDataDir(string exeDir)
        {
            string beside = Path.Combine(exeDir, "data");
            try
            {
                Directory.CreateDirectory(beside);
                string probe = Path.Combine(beside, ".write-test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return beside;
            }
            catch
            {
                string local = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ScheduleDeck", "data");
                Directory.CreateDirectory(local);
                return local;
            }
        }

        private static string ExtractPayload(Stream payload)
        {
            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ScheduleDeck");
            string stamp = ReadStamp();
            string target = Path.Combine(root, "app-" + stamp);
            string marker = Path.Combine(target, ".ready");

            if (!File.Exists(marker))
            {
                if (Directory.Exists(target))
                {
                    try { Directory.Delete(target, true); } catch { }
                }
                Directory.CreateDirectory(target);

                using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in zip.Entries)
                    {
                        string name = entry.FullName.Replace('\\', '/');
                        if (name.EndsWith("/"))
                        {
                            string dirPath = name.TrimEnd('/').Replace('/', Path.DirectorySeparatorChar);
                            if (dirPath.Length > 0) Directory.CreateDirectory(Path.Combine(target, dirPath));
                            continue;
                        }
                        string dest = Path.Combine(target, name.Replace('/', Path.DirectorySeparatorChar));
                        string parent = Path.GetDirectoryName(dest);
                        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                        entry.ExtractToFile(dest, true);
                    }
                }
                File.WriteAllText(marker, stamp);
            }

            CleanupOldVersions(root, target);
            return target;
        }

        private static string ReadStamp()
        {
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream s = asm.GetManifestResourceStream("Stamp.txt"))
                {
                    if (s == null) return "dev";
                    using (var reader = new StreamReader(s, Encoding.UTF8))
                    {
                        string text = reader.ReadToEnd().Trim();
                        return text.Length == 0 ? "dev" : text;
                    }
                }
            }
            catch
            {
                return "dev";
            }
        }

        private static void CleanupOldVersions(string root, string keep)
        {
            try
            {
                foreach (string dir in Directory.GetDirectories(root, "app-*"))
                {
                    if (string.Equals(Path.GetFullPath(dir), Path.GetFullPath(keep), StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    try { Directory.Delete(dir, true); } catch { }
                }
            }
            catch
            {
            }
        }

        /* ---------------------------------------------------------------- 服务 */

        private static void StartServer()
        {
            int port = FindFreePort();
            string nodePath = Path.Combine(_appDir, Path.Combine("runtime", "node.exe"));
            if (!File.Exists(nodePath)) nodePath = "node.exe";

            var log = new StreamWriter(Path.Combine(_dataDir, "server.log"), false, Encoding.UTF8);
            log.AutoFlush = true;

            var psi = new ProcessStartInfo();
            psi.FileName = nodePath;
            psi.Arguments = Quote(Path.Combine(_appDir, "server.js")) + " --port " + port + " --data " + Quote(_dataDir);
            psi.WorkingDirectory = _appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            _node = new Process();
            _node.StartInfo = psi;
            _node.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) log.WriteLine(e.Data);
            };
            _node.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) log.WriteLine(e.Data);
            };
            _node.Start();
            _node.BeginOutputReadLine();
            _node.BeginErrorReadLine();

            _baseUrl = "http://127.0.0.1:" + port + "/";
            if (!WaitHealthy(40))
            {
                throw new Exception("本地服务没有在 20 秒内启动，请查看日志。");
            }
        }

        private static bool WaitHealthy(int tries)
        {
            for (int i = 0; i < tries; i++)
            {
                Thread.Sleep(250);
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(_baseUrl + "api/health");
                    req.Timeout = 800;
                    req.ReadWriteTimeout = 800;
                    using (var res = (HttpWebResponse)req.GetResponse())
                    {
                        if (res.StatusCode == HttpStatusCode.OK) return true;
                    }
                }
                catch
                {
                }
            }
            return false;
        }

        private static int FindFreePort()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        /* ---------------------------------------------------------------- 托盘 */

        private static void SetupTray()
        {
            _appIcon = LoadIcon();
            _tray = new NotifyIcon();
            _tray.Icon = _appIcon;
            _tray.Text = "日程舱 · 飞书任务提醒";
            _tray.Visible = true;

            var menu = new ContextMenuStrip();
            menu.Items.Add("打开日程舱", null, delegate { OpenWindow(); });
            menu.Items.Add("在默认浏览器中打开", null, delegate { Process.Start(_baseUrl); });
            menu.Items.Add("检查更新…", null, delegate { CheckForUpdate(true); });
            menu.Items.Add("打开数据目录", null, delegate { Process.Start("explorer.exe", "\"" + _dataDir + "\""); });
            if (_packaged)
            {
                menu.Items.Add("打开程序目录", null, delegate { Process.Start("explorer.exe", "\"" + _appDir + "\""); });
            }
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApp(); });
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { OpenWindow(); };
            StartUpdateTimer();
            if (_packaged) StartApplyWatcher();
            if (_autoInstall) CheckForUpdate(false);
        }

        /* ---------------------------------------------------------------- 页面发起的更新 */

        /// <summary>页面下载并校验好之后会写 data\update\apply.json，这里负责退出、替换、重启</summary>
        private static void StartApplyWatcher()
        {
            var t = new System.Windows.Forms.Timer();
            t.Interval = 2000;
            t.Tick += delegate
            {
                try
                {
                    string request = Path.Combine(_dataDir, "update", "apply.json");
                    if (!File.Exists(request)) return;
                    string text = File.ReadAllText(request, Encoding.UTF8);
                    try { File.Delete(request); } catch { }
                    string file = MatchValue(text, "path");
                    string sha = MatchValue(text, "sha256");
                    if (file.Length == 0 || !File.Exists(file)) return;
                    if (sha.Length > 0)
                    {
                        string got = Sha256File(file);
                        if (!string.Equals(got, sha, StringComparison.OrdinalIgnoreCase)) return;
                    }
                    ApplyUpdate(file);
                }
                catch
                {
                }
            };
            t.Start();
            _applyTimer = t;
        }

        /* ---------------------------------------------------------------- 自动更新 */

        private static string CurrentStamp()
        {
            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Stamp.txt"))
                {
                    if (s == null) return "0";
                    using (var r = new StreamReader(s, Encoding.UTF8))
                    {
                        string v = r.ReadToEnd().Trim();
                        return v.Length > 0 ? v : "0";
                    }
                }
            }
            catch
            {
                return "0";
            }
        }

        private static string ReadManifestUrl()
        {
            try
            {
                string file = Path.Combine(_dataDir, "update.json");
                if (!File.Exists(file)) return "";
                string text = File.ReadAllText(file, Encoding.UTF8);
                var m = System.Text.RegularExpressions.Regex.Match(text, "\"manifestUrl\"\\s*:\\s*\"([^\"]*)\"");
                if (!m.Success) return "";
                return m.Groups[1].Value.Replace("\\/", "/").Trim();
            }
            catch
            {
                return "";
            }
        }

        private static bool ReadAutoUpdate()
        {
            try
            {
                string file = Path.Combine(_dataDir, "update.json");
                if (!File.Exists(file)) return true;
                string text = File.ReadAllText(file, Encoding.UTF8);
                var m = System.Text.RegularExpressions.Regex.Match(text, "\"auto\"\\s*:\\s*(true|false)");
                return !m.Success || m.Groups[1].Value == "true";
            }
            catch
            {
                return true;
            }
        }

        private static void StartUpdateTimer()
        {
            if (!_packaged) return;
            if (!ReadAutoUpdate()) return;
            if (ReadManifestUrl().Length == 0) return;

            var later = new System.Windows.Forms.Timer();
            later.Interval = 40000;
            later.Tick += delegate
            {
                later.Stop();
                later.Dispose();
                CheckForUpdate(false);
            };
            later.Start();

            _updateTimer = new System.Windows.Forms.Timer();
            _updateTimer.Interval = 60 * 60 * 1000;
            _updateTimer.Tick += delegate { CheckForUpdate(false); };
            _updateTimer.Start();
        }

        private static string MatchValue(string text, string key)
        {
            var m = System.Text.RegularExpressions.Regex.Match(
                text, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value.Replace("\\/", "/") : "";
        }

        private static void CheckForUpdate(bool manual)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    string manifestUrl = ReadManifestUrl();
                    if (manifestUrl.Length == 0)
                    {
                        if (manual)
                        {
                            MessageBox.Show(
                                "还没配置更新地址。\n\n打开「设置 → 外观与数据 → 自动更新」，把 latest.json 的网址填进去。",
                                "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                        return;
                    }

                    string text;
                    var req = (HttpWebRequest)WebRequest.Create(manifestUrl);
                    req.Timeout = 20000;
                    req.Headers.Add("Cache-Control", "no-cache");
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        text = sr.ReadToEnd();
                    }

                    string stamp = MatchValue(text, "stamp");
                    string version = MatchValue(text, "version");
                    string url = MatchValue(text, "url");
                    string sha = MatchValue(text, "sha256");
                    string notes = MatchValue(text, "notes");
                    if (stamp.Length == 0 || url.Length == 0)
                    {
                        if (manual) MessageBox.Show("latest.json 格式不对：至少要 version/stamp/url/sha256。", "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return;
                    }

                    string current = CurrentStamp();
                    if (string.CompareOrdinal(stamp, current) <= 0)
                    {
                        if (manual)
                        {
                            MessageBox.Show("已经是最新版本了。（当前 " + current + "）", "检查更新",
                                MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                        return;
                    }

                    string msg = "发现新版本 " + version + "（当前 " + current + "）"
                        + (notes.Length > 0 ? "\n\n" + notes : "")
                        + "\n\n现在下载并更新吗？更新时程序会自动重启。";
                    if (!_autoInstall
                        && MessageBox.Show(msg, "日程舱 更新", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                    {
                        return;
                    }

                    string tmp = Path.Combine(Path.GetTempPath(), "sd-update-" + Guid.NewGuid().ToString("N") + ".exe");
                    using (var wc = new WebClient())
                    {
                        wc.Headers.Add("Cache-Control", "no-cache");
                        wc.DownloadFile(url, tmp);
                    }

                    string got = Sha256File(tmp);
                    if (sha.Length > 0 && !string.Equals(got, sha, StringComparison.OrdinalIgnoreCase))
                    {
                        try { File.Delete(tmp); } catch { }
                        MessageBox.Show("下载下来的文件校验不通过，已取消更新。\n\n期望 " + sha + "\n实际 " + got,
                            "更新失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    ApplyUpdate(tmp);
                }
                catch (Exception ex)
                {
                    if (manual)
                    {
                        MessageBox.Show("检查更新失败：" + ex.Message, "检查更新", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }
            });
        }

        private static string Sha256File(string path)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            using (var fs = File.OpenRead(path))
            {
                byte[] hash = sha.ComputeHash(fs);
                var sb = new StringBuilder();
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        private static void ApplyUpdate(string newExe)
        {
            string exePath = Application.ExecutablePath;
            string name = Path.GetFileName(exePath);
            string log = Path.Combine(_dataDir, "update.log");
            string bat = Path.Combine(Path.GetTempPath(), "sd-apply-" + Guid.NewGuid().ToString("N") + ".bat");

            var sb = new StringBuilder();
            sb.AppendLine("@echo off");
            sb.AppendLine("chcp 936 >nul");
            sb.AppendLine("echo [%date% %time%] 准备替换 >> \"" + log + "\"");
            sb.AppendLine(":wait");
            sb.AppendLine("tasklist /fi \"imagename eq " + name + "\" | find /i \"" + name + "\" >nul");
            sb.AppendLine("if not errorlevel 1 (ping 127.0.0.1 -n 2 >nul & goto wait)");
            sb.AppendLine("copy /y \"" + exePath + "\" \"" + exePath + ".bak\" >> \"" + log + "\" 2>&1");
            sb.AppendLine("move /y \"" + newExe + "\" \"" + exePath + "\" >> \"" + log + "\" 2>&1");
            sb.AppendLine("if errorlevel 1 (");
            sb.AppendLine("  echo 替换失败，回滚 >> \"" + log + "\"");
            sb.AppendLine("  copy /y \"" + exePath + ".bak\" \"" + exePath + "\" >> \"" + log + "\" 2>&1");
            sb.AppendLine(")");
            sb.AppendLine("echo [%date% %time%] 启动新版 >> \"" + log + "\"");
            sb.AppendLine("start \"\" \"" + exePath + "\"");
            sb.AppendLine("del \"%~f0\"");
            // cmd 按系统 ANSI 读批处理，中文路径必须用 Default(GBK) 写
            File.WriteAllText(bat, sb.ToString(), Encoding.Default);

            var psi = new ProcessStartInfo("cmd.exe", "/c \"" + bat + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(psi);

            ExitApp();
        }

        private static Icon LoadIcon()
        {
            try
            {
                string path = Path.Combine(_appDir, "app.ico");
                if (File.Exists(path)) return new Icon(path);
            }
            catch
            {
            }
            try
            {
                Icon embedded = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (embedded != null) return embedded;
            }
            catch
            {
            }
            return SystemIcons.Application;
        }

        private static void OpenWindow()
        {
            // 已经有窗口就把它叫到前面，别又开一个
            if (FocusExistingWindow()) return;
            OpenAppWindow(_baseUrl);
        }

        private static void OpenAppWindow(string url)
        {
            try
            {
                if (_profileDir == null)
                {
                    _profileDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "ScheduleDeck", "browser");
                    try { Directory.CreateDirectory(_profileDir); } catch { }
                }
                string browser = FindBrowser();
                if (browser == null)
                {
                    Process.Start(url);
                    return;
                }
                var psi = new ProcessStartInfo();
                psi.FileName = browser;
                psi.Arguments = "--app=" + url
                    + " --user-data-dir=" + Quote(_profileDir)
                    + " --no-first-run --no-default-browser-check --window-size=1440,940"
                    + " --disable-features=Translate,MediaRouter";
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法打开界面：" + ex.Message, "日程舱",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /* ---------------------------------------------------------------- 窗口 */

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        /// <summary>找已经打开的「日程舱」应用窗口（Chromium --app），有就还原并置前</summary>
        private static bool FocusExistingWindow()
        {
            IntPtr found = IntPtr.Zero;
            try
            {
                EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
                {
                    if (!IsWindowVisible(hWnd)) return true;
                    var sb = new StringBuilder(512);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();
                    if (title.IndexOf("日程舱", StringComparison.Ordinal) < 0) return true;
                    bool looksLikeApp = title.IndexOf("ScheduleDeck", StringComparison.OrdinalIgnoreCase) >= 0
                        || title.IndexOf("飞书", StringComparison.Ordinal) >= 0
                        || title.Trim() == "日程舱";
                    if (!looksLikeApp) return true;
                    found = hWnd;
                    return false;
                }, IntPtr.Zero);
            }
            catch
            {
            }
            if (found == IntPtr.Zero) return false;
            try
            {
                ShowWindow(found, 9); // SW_RESTORE
                SetForegroundWindow(found);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string FindBrowser()
        {
            string pf = Environment.GetEnvironmentVariable("ProgramFiles");
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string local = Environment.GetEnvironmentVariable("LocalAppData");
            string[] candidates = new string[]
            {
                pf == null ? null : Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                pf86 == null ? null : Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
                local == null ? null : Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
                pf86 == null ? null : Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
                pf == null ? null : Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            };
            foreach (string path in candidates)
            {
                if (path != null && File.Exists(path)) return path;
            }
            return null;
        }

        private static string Quote(string value)
        {
            return "\"" + value + "\"";
        }

        /* ---------------------------------------------------------------- 退出 */

        private static void ExitApp()
        {
            StopServer();
            Application.Exit();
        }

        private static void StopServer()
        {
            Process node = _node;
            _node = null;
            if (node != null)
            {
                try
                {
                    if (!node.HasExited)
                    {
                        try
                        {
                            var req = (HttpWebRequest)WebRequest.Create(_baseUrl + "api/shutdown");
                            req.Method = "POST";
                            req.Timeout = 700;
                            req.GetResponse().Close();
                        }
                        catch
                        {
                        }
                        if (!node.WaitForExit(1500))
                        {
                            try { node.Kill(); } catch { }
                        }
                    }
                }
                catch
                {
                }
            }
            if (_tray != null)
            {
                _tray.Visible = false;
                _tray.Dispose();
                _tray = null;
            }
        }

        private static void OpenExisting()
        {
            // 二次启动：优先把已经在跑的应用窗口叫到前面；窗口关了就再开一个（不丢到默认浏览器）
            try
            {
                string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
                string portFile = Path.Combine(dir, "port.txt");
                if (File.Exists(portFile))
                {
                    string port = File.ReadAllText(portFile).Trim();
                    if (port.Length > 0)
                    {
                        if (FocusExistingWindow()) return;
                        OpenAppWindow("http://127.0.0.1:" + port + "/");
                        return;
                    }
                }
            }
            catch
            {
            }
            MessageBox.Show("日程舱已经在运行了，请在任务栏右下角的托盘里打开。", "日程舱",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
