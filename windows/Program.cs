using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace AngelaDesktop {
  internal sealed class Launcher : ApplicationContext {
    private readonly Process server;
    private readonly NotifyIcon tray;
    private readonly string url;
    private readonly string root;

    public Launcher(bool smoke) {
      string executableDir = AppDomain.CurrentDomain.BaseDirectory;
      root = File.Exists(Path.Combine(executableDir, "server.mjs")) ? executableDir : Path.GetFullPath(Path.Combine(executableDir, ".."));
      if (!File.Exists(Path.Combine(root, "server.mjs"))) throw new Exception("Angela 프로그램 파일을 찾을 수 없습니다.");
      string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Angela", "data");
      Directory.CreateDirectory(data);
      string saved = Path.Combine(data, "catalog.json");
      string previous = Path.Combine(root, "data", "catalog.json");
      if (!File.Exists(saved) && File.Exists(previous)) File.Copy(previous, saved);
      int port = FreePort();
      url = "http://127.0.0.1:" + port + "/";
      string localNode = Path.Combine(executableDir, "node.exe");
      ProcessStartInfo start = new ProcessStartInfo(File.Exists(localNode) ? localNode : "node.exe", "server.mjs");
      start.WorkingDirectory = root;
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      start.EnvironmentVariables["DATA_DIR"] = data;
      start.EnvironmentVariables["PORT"] = port.ToString();
      start.EnvironmentVariables["HOST"] = "127.0.0.1";
      server = Process.Start(start);
      if (server == null || !WaitForServer()) throw new Exception("Angela 서버를 시작하지 못했습니다. Node.js 실행 파일을 확인하세요.");
      if (smoke) { Shutdown(); return; }
      ContextMenu menu = new ContextMenu();
      menu.MenuItems.Add("관리 화면 열기", (sender, args) => OpenWindow());
      menu.MenuItems.Add("종료", (sender, args) => ExitThread());
      tray = new NotifyIcon();
      tray.Icon = SystemIcons.Application;
      tray.Text = "Angela 도서 실물조사";
      tray.ContextMenu = menu;
      tray.DoubleClick += (sender, args) => OpenWindow();
      tray.Visible = true;
      server.EnableRaisingEvents = true;
      server.Exited += (sender, args) => { if (tray.Visible) Application.ExitThread(); };
      OpenWindow();
    }

    private static int FreePort() {
      TcpListener listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
      listener.Start();
      int port = ((IPEndPoint)listener.LocalEndpoint).Port;
      listener.Stop();
      return port;
    }
    private bool WaitForServer() {
      for (int i=0;i<80;i++) {
        if (server.HasExited) return false;
        try {
          HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
          request.Timeout = 500;
          using (HttpWebResponse response = (HttpWebResponse)request.GetResponse()) if (response.StatusCode == HttpStatusCode.OK) return true;
        } catch (WebException) { }
        Thread.Sleep(100);
      }
      return false;
    }
    private void OpenWindow() {
      string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
      if (File.Exists(edge)) {
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Angela", "EdgeProfile");
        Process.Start(edge, "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\"");
      } else Process.Start(url);
    }
    private void Shutdown() {
      if (server != null && !server.HasExited) { try { server.Kill(); server.WaitForExit(3000); } catch { } }
    }
    protected override void ExitThreadCore() {
      if (tray != null) { tray.Visible = false; tray.Dispose(); }
      Shutdown();
      base.ExitThreadCore();
    }
    [STAThread] private static int Main(string[] args) {
      try {
        bool smoke = args.Length>0 && args[0] == "--smoke";
        if (!smoke) Application.EnableVisualStyles();
        Launcher launcher = new Launcher(smoke);
        if (!smoke) Application.Run(launcher);
        return 0;
      } catch (Exception error) {
        if (args.Length>0 && args[0] == "--smoke") File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "smoke-error.txt"), error.ToString());
        else MessageBox.Show(error.Message, "Angela 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
      }
    }
  }
}
