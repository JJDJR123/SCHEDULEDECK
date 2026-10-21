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
        private static Process _node;
        private static string _baseUrl;
        private static string _appDir;
        private static string _dataDir;
        private static string _profileDir;
        private static Icon _appIcon;
        private static bool _noWindow;
        private static bool _packaged;

        [STAThread]
        private static void Main(string[] args)
        {
            _noWindow = Array.IndexOf(args, "--no-window") >= 0;

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
            menu.Items.Add("打开数据目录", null, delegate { Process.Start("explorer.exe", "\"" + _dataDir + "\""); });
            if (_packaged)
            {
                menu.Items.Add("打开程序目录", null, delegate { Process.Start("explorer.exe", "\"" + _appDir + "\""); });
            }
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApp(); });
            _tray.ContextMenuStrip = menu;
            _tray.DoubleClick += delegate { OpenWindow(); };
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
            try
            {
                string browser = FindBrowser();
                if (browser == null)
                {
                    Process.Start(_baseUrl);
                    return;
                }
                var psi = new ProcessStartInfo();
                psi.FileName = browser;
                psi.Arguments = "--app=" + _baseUrl
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
            try
            {
                string dir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
                string portFile = Path.Combine(dir, "port.txt");
                if (File.Exists(portFile))
                {
                    string port = File.ReadAllText(portFile).Trim();
                    if (port.Length > 0)
                    {
                        Process.Start("http://127.0.0.1:" + port + "/");
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
