# btool

Cross-browser CLI & Model Context Protocol (MCP) automation tool with integrated shell command execution, specifically designed for **Zen Browser**, **Firefox**, and **Brave**.

## Features

- **Zen Browser & Firefox Support**: Driven natively over W3C WebDriver BiDi (no third-party heavy browser automation frameworks required).
- **Brave Support**: Driven over Chrome DevTools Protocol (CDP).
- **Interactive Element Tagging**: Automatic numbered labels for links, buttons, and inputs for easy clicking (`btool click 1`).
- **Full Viewport Screenshots**: Capture screenshots directly via `btool screenshot [-o path]`.
- **Profile Attachment & Lock Avoidance**: Attach directly to your personal everyday profiles (e.g. `btool start --profile default`) with automatic safe cloning if your browser is actively open.
- **Cookie & Session Management**: Save and load authentication cookies to/from JSON.
- **Event Streaming**: Live tracking of browser console logs (`btool logs`) and network requests (`btool network`).
- **Zero-Latency Daemon**: Runs a background Unix domain socket (`~/.btool.sock`) so CLI commands share the same live browser session.
- **Built-in CLI Command Execution**: Run terminal commands (`btool exec`) and pipe data between shell processes and the browser DOM.
- **MCP Server Mode (`btool --mcp`)**: Native Model Context Protocol interface exposing browser tools directly to AI coding assistants (Antigravity, Claude, etc.).

## Installation & Availability

The binary is linked globally in `~/.local/bin/btool`.

```bash
# Check installation
btool --help
```

---

## CLI Usage

### 1. Launch a Browser Session
```bash
# Start Zen Browser (headless by default with ephemeral profile)
btool start --browser zen

# Or launch headful
btool start --browser zen --headful

# Or attach to your everyday browsing profile (authenticated sessions)
btool start --browser zen --profile default

# Or launch Firefox / Brave
btool start --browser firefox
btool start --browser brave
```

### 2. Browser Navigation & Snapshotting
```bash
# Navigate to a URL
btool navigate "https://example.com"

# View readable page content
btool snapshot

# Capture a screenshot
btool screenshot -o /tmp/page.png
```

### 3. Interactive Element Clicking & Forms
```bash
# List all visible interactive elements with numeric IDs
btool elements

# Click by numeric ID or CSS selector
btool click 1
btool click "button.submit"

# Fill inputs by numeric ID or CSS selector
btool fill 2 "my search term"
```

### 4. Cookies & Authentication
```bash
# Inspect all cookies
btool cookies get

# Save cookies to file
btool cookies save session-cookies.json

# Restore cookies into browser
btool cookies load session-cookies.json
```

### 5. Console Logs & Network Streaming
```bash
# View console errors and logs
btool logs

# View network requests and HTTP status codes
btool network

# Clear history
btool logs --clear
btool network --clear
```

### 6. Integrated CLI Execution & Shell Piping
```bash
# Run a system command inside the session
btool exec "uname -a"

# Pipe output from browser evaluation to Linux utilities
btool eval "document.body.innerText" | grep -i "documentation"
```

### 7. Stop Session
```bash
btool stop
```

---

## MCP Server Configuration

Configured in `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "btool": {
      "command": "/home/buchhalt/.local/bin/btool",
      "args": ["--mcp"]
    }
  }
}
```

### Tools Exposed via MCP:
- `browser_start`: Launch Zen, Firefox, or Brave session
- `browser_navigate`: Navigate to URL
- `browser_snapshot`: Read title, URL, and page text
- `browser_screenshot`: Capture viewport PNG
- `browser_elements`: List interactive elements with numeric IDs
- `browser_click`: Click element by numeric ID or CSS selector
- `browser_fill`: Input text by numeric ID or CSS selector
- `browser_evaluate`: Run JavaScript expression
- `browser_get_logs`: Fetch console logs and errors
- `browser_get_network`: Fetch recent HTTP requests/responses
- `system_exec`: Execute shell commands
- `browser_stop`: Close browser session
