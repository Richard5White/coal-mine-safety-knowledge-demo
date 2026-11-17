const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const captureDir = path.join(projectRoot, "video_output", "captures");
const profileDir = path.join(projectRoot, "video_output", "edge-profile");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const debugPort = 9229;
const targetUrl = "http://127.0.0.1:8021";

fs.mkdirSync(captureDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_) {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

async function main() {
  const edge = spawn(edgePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1920,1080",
    "--hide-scrollbars",
    "--disable-features=Translate,msEdgeSidebarV2",
    "--no-first-run",
    "--no-default-browser-check",
    targetUrl
  ], { stdio: "ignore", windowsHide: true });

  let client;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = pages.find((item) => item.type === "page" && item.url.startsWith(targetUrl)) || pages.find((item) => item.type === "page");
    if (!page) throw new Error("No debuggable Edge page found");
    client = createCdpClient(page.webSocketDebuggerUrl);
    await client.opened;
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
      return result.result.value;
    };
    const waitFor = async (expression, timeoutMs = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await delay(150);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    };
    const click = async (selector) => {
      const encoded = JSON.stringify(selector);
      const ok = await evaluate(`(()=>{const e=document.querySelector(${encoded});if(!e)return false;e.click();return true})()`);
      if (!ok) throw new Error(`Element not found: ${selector}`);
      await delay(380);
    };
    const screenshot = async (name) => {
      const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const filePath = path.join(captureDir, `${name}.png`);
      fs.writeFileSync(filePath, Buffer.from(result.data, "base64"));
      process.stdout.write(`${name}.png\n`);
    };

    await waitFor("document.readyState === 'complete'");
    await waitFor("document.querySelectorAll('.graph-node').length > 0", 15000);
    await delay(700);

    await screenshot("01_intro");

    await click("#evidenceList .evidence-card:first-child");
    await screenshot("02_platform");

    const question = "某工作面瓦斯浓度连续升高，同时局部通风机运行异常，可能产生哪些风险？";
    await evaluate(`(()=>{const e=document.querySelector('#questionInput');e.value=${JSON.stringify(question)};e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();return true})()`);
    await screenshot("03_query");

    await click("#analyzeButton");
    await delay(700);
    await click("#nodeLayer .graph-node.focus");
    await screenshot("04_risk_graph");

    await click(".view-button[data-view='timeline']");
    await click("#timelineEvents .timeline-card:nth-of-type(3)");
    await screenshot("05_timeline");

    await click(".nav-item[data-module='knowledge']");
    await click(".tool-chip[data-kg-mode='risk']");
    await click("#kgNodeLayer .kg-node.disaster");
    await screenshot("06_knowledge");

    await click(".nav-item[data-module='construction']");
    await click("[data-build-stage='2']");
    await screenshot("07_pipeline");

    await click("[data-construction-view='ontology']");
    await click("[data-relation-index='3']");
    await screenshot("08_ontology");

    await click("[data-construction-view='triples']");
    await click("[data-triple-index='3']");
    await screenshot("09_triples");

    await click("[data-construction-view='fusion']");
    await click("[data-fusion-method='2']");
    await screenshot("10_fusion");

    await click(".nav-item[data-module='collaboration']");
    await click("[data-collab-stage='fusion']");
    await click("[data-collab-view='graph']");
    await screenshot("11_collaboration");

    await click("[data-collab-stage='output']");
    await click("#collabEvidenceList button:nth-child(3)");
    await screenshot("12_grounded_answer");

    await click(".nav-item[data-module='governance']");
    await click(".source-item[data-source='cases']");
    await click(".pipeline-stage[data-pipeline-stage='quality']");
    await screenshot("13_governance");
  } finally {
    if (client) client.close();
    edge.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
