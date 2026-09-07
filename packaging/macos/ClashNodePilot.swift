import AppKit
import Foundation
import Darwin

private let defaultPort = 3210
private let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("ClashNodePilot", isDirectory: true)

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var node: Process?
    private var nodePID: pid_t = 0
    private var dashboardURL: URL?
    private var headless = false
    private var port = defaultPort
    private var instance = UUID().uuidString
    private var stopping = false
    private var configOverride: String?
    private var terminationSignal: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let bundleIdentifier = Bundle.main.bundleIdentifier {
            let currentPID = ProcessInfo.processInfo.processIdentifier
            if let existing = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
                .first(where: { $0.processIdentifier != currentPID }) {
                existing.activate(options: [.activateIgnoringOtherApps])
                NSApp.terminate(nil)
                return
            }
        }
        headless = ProcessInfo.processInfo.environment["CLASH_PILOT_NO_BROWSER"] == "1"
        signal(SIGTERM, SIG_IGN)
        terminationSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        terminationSignal?.setEventHandler { NSApp.terminate(nil) }
        terminationSignal?.resume()
        port = validatedPort(ProcessInfo.processInfo.environment["PORT"])
        guard startNode() else { return }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.title = "CN"
        statusItem.button?.toolTip = "Clash Node Pilot"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Choose Controller Config", action: #selector(chooseConfig), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        menu.items.forEach { $0.target = self }
        statusItem.menu = menu
        if !headless { openDashboard() }
    }

    func applicationWillTerminate(_ notification: Notification) { stopNode() }

    private func validatedPort(_ value: String?) -> Int {
        guard let value, let result = Int(value), (1...65535).contains(result) else { return defaultPort }
        return result
    }

    private func resource(_ name: String) -> URL? { Bundle.main.resourceURL?.appendingPathComponent(name) }

    private func selectedConfig() -> String? {
        if let configOverride { return configOverride }
        let env = ProcessInfo.processInfo.environment["CLASH_CONFIG"]
        if let env, !env.isEmpty { return env }
        if let saved = UserDefaults.standard.string(forKey: "controllerConfigPath"), FileManager.default.fileExists(atPath: saved) { return saved }
        let fallback = appSupport.appendingPathComponent("controller.yaml").path
        return FileManager.default.fileExists(atPath: fallback) ? fallback : nil
    }

    @discardableResult private func startNode() -> Bool {
        guard node == nil else { return true }
        let config = selectedConfig()
        if let config {
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: config, isDirectory: &isDirectory),
                  !isDirectory.boolValue, FileManager.default.isReadableFile(atPath: config) else {
                fail("The selected controller configuration is not a readable file. Check CLASH_CONFIG or select another configuration.", code: 7)
                return false
            }
        }
        guard !portIsOccupied(port) else { fail("Port \(port) is already in use. Choose another PORT or stop the owning service.", code: 2); return false }
        guard let executable = resource("app/runtime/node"), let server = resource("app/server.js") else {
            fail("The app bundle is missing runtime/node or app/server.js.", code: 3); return false
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = [server.path]
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = String(port)
        environment["CLASH_PILOT_INSTANCE"] = instance
        if let config { environment["CLASH_CONFIG"] = config }
        process.environment = environment
        process.standardOutput = FileHandle.standardOutput
        process.standardError = FileHandle.standardError
        process.terminationHandler = { [weak self] terminatedProcess in
            guard let self else { return }
            DispatchQueue.main.async {
                guard self.node?.processIdentifier == terminatedProcess.processIdentifier, !self.stopping else { return }
                self.node = nil
                self.nodePID = 0
                self.fail("The bundled Node service exited unexpectedly.", code: 6)
            }
        }
        do {
            try process.run()
            node = process
            nodePID = process.processIdentifier
        } catch {
            fail("Could not start the bundled Node runtime: \(error.localizedDescription)", code: 4); return false
        }
        let ready = waitForHealth(process: process)
        if !ready {
            stopNode()
            fail("Clash Node Pilot did not become healthy on port \(port).", code: 5)
            return false
        }
        dashboardURL = URL(string: "http://127.0.0.1:\(port)/")
        return true
    }

    private func waitForHealth(process: Process) -> Bool {
        for _ in 0..<100 {
            if !process.isRunning { return false }
            if let response = healthResponse(), response.ok && response.port == port && response.instance == instance && process.isRunning { return true }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return false
    }

    private func healthResponse() -> (ok: Bool, port: Int, instance: String)? {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 0.25)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let semaphore = DispatchSemaphore(value: 0)
        var result: (Bool, Int, String)?
        let resultLock = NSLock()
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let ok = object["ok"] as? Bool, let responsePort = object["port"] as? Int,
                  let responseInstance = object["instance"] as? String else { return }
            resultLock.lock()
            result = (ok, responsePort, responseInstance)
            resultLock.unlock()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 0.35)
        resultLock.lock()
        defer { resultLock.unlock() }
        return result
    }

    private func portIsOccupied(_ port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        inet_pton(AF_INET, "127.0.0.1", &address.sin_addr)
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
        }
    }

    @objc private func openDashboard() {
        guard let dashboardURL else { return }
        NSWorkspace.shared.open(dashboardURL)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if node != nil { openDashboard() }
        return true
    }

    @objc private func chooseConfig() {
        let panel = NSOpenPanel()
        panel.allowedFileTypes = ["yaml", "yml"]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        configOverride = url.path
        UserDefaults.standard.set(url.path, forKey: "controllerConfigPath")
        stopNode()
        _ = startNode()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func stopNode() {
        guard let process = node, process.isRunning, process.processIdentifier == nodePID else { node = nil; nodePID = 0; return }
        stopping = true
        process.terminationHandler = nil
        process.terminate()
        let deadline = Date().addingTimeInterval(2.0)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            let killDeadline = Date().addingTimeInterval(0.5)
            while process.isRunning && Date() < killDeadline { Thread.sleep(forTimeInterval: 0.02) }
        }
        node = nil; nodePID = 0
        stopping = false
    }

    private func fail(_ message: String, code: Int32) {
        if headless {
            FileHandle.standardError.write(("ClashNodePilot: \(message)\n").data(using: .utf8)!)
            exit(code)
        }
        let alert = NSAlert(); alert.messageText = "Clash Node Pilot"; alert.informativeText = message; alert.alertStyle = .warning; alert.runModal()
        NSApp.terminate(nil)
    }
}

@main
struct ClashNodePilotMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
