const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "video_output");
const profileDir = path.join(outputDir, "interface-recording-profile");
const outputFile = path.join(outputDir, "coal-mine-interface-demo.webm");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = "http://127.0.0.1:8021";
const debugPort = 9231;
const fps = 2;
const frameDelay = Math.round(1000 / fps);
const narrations = JSON.parse(fs.readFileSync(path.join(__dirname, "narration.json"), "utf8"));

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });
if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function wavDuration(file) {
  const data = fs.readFileSync(file);
  const byteRate = data.readUInt32LE(28);
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === "data") return size / byteRate;
    offset += 8 + size + (size % 2);
  }
  throw new Error(`Cannot read WAV duration: ${file}`);
}

async function waitJson(url, timeout = 15000, options = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const r = await fetch(url, options); if (r.ok) return r.json(); } catch (_) {}
    await delay(200);
  }
  throw new Error(`Timed out: ${url}`);
}

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const task = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? task.reject(new Error(msg.error.message)) : task.resolve(msg.result);
  });
  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id; pending.set(callId, { resolve, reject });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

async function main() {
  const edge = spawn(edgePath, [
    "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
    "--window-size=1920,1080", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
    "--disable-features=Translate,msEdgeSidebarV2", "--no-first-run", "--no-default-browser-check", baseUrl
  ], { stdio: "ignore", windowsHide: true });

  let app, recorder;
  try {
    const pages = await waitJson(`http://127.0.0.1:${debugPort}/json/list`);
    const appPage = pages.find((p) => p.type === "page" && p.url.startsWith(baseUrl));
    if (!appPage) throw new Error("Application tab not found");
    const recorderUrl = encodeURIComponent(`${baseUrl}/index.html?recordingHost=1`);
    const recPage = await waitJson(`http://127.0.0.1:${debugPort}/json/new?${recorderUrl}`, 15000, { method: "PUT" });
    app = cdp(appPage.webSocketDebuggerUrl); recorder = cdp(recPage.webSocketDebuggerUrl);
    await Promise.all([app.opened, recorder.opened]);
    await app.send("Page.enable"); await app.send("Runtime.enable");
    await recorder.send("Page.enable"); await recorder.send("Runtime.enable");
    await app.send("Emulation.setDeviceMetricsOverride", { width:1920, height:1080, deviceScaleFactor:1, mobile:false });
    await recorder.send("Page.setDownloadBehavior", { behavior:"allow", downloadPath:outputDir });

    const evalOn = async (client, expression, awaitPromise = true) => {
      const r = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue:true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const evalApp = (expression, wait = true) => evalOn(app, expression, wait);
    const evalRec = (expression, wait = true) => evalOn(recorder, expression, wait);

    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (await evalApp("document.readyState==='complete' && document.querySelectorAll('.graph-node').length>0")) break;
      await delay(200);
    }

    const audioUrls = narrations.map((n) => `${baseUrl}/video_output/audio/${n.id}.wav`);
    const recorderSetup = `
      (async()=>{
        document.body.style.margin='0'; document.body.style.background='#071a24';
        const c=document.createElement('canvas'); c.width=1920; c.height=1080; document.body.appendChild(c);
        const ctx=c.getContext('2d'); ctx.fillStyle='#f4f8f9'; ctx.fillRect(0,0,c.width,c.height);
        const ac=new AudioContext(); await ac.resume(); const dest=ac.createMediaStreamDestination();
        const urls=${JSON.stringify(audioUrls)}; const buffers={};
        for(let i=0;i<urls.length;i++){const b=await (await fetch(urls[i])).arrayBuffer(); buffers[i]=await ac.decodeAudioData(b);}
        const stream=c.captureStream(${fps}); stream.addTrack(dest.stream.getAudioTracks()[0]);
        const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(MediaRecorder.isTypeSupported);
        if(!mime) throw new Error('No supported WebM MediaRecorder codec');
        const chunks=[]; const mr=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000,audioBitsPerSecond:128000});
        mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}; mr.start(1000);
        window.playSegment=(i)=>{const s=ac.createBufferSource();s.buffer=buffers[i];s.connect(dest);s.start();return buffers[i].duration};
        window.drawFrame=(data,x,y,pulse)=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{ctx.drawImage(img,0,0,1920,1080);ctx.save();ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=8;ctx.fillStyle='#ffffff';ctx.strokeStyle='#087f8c';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+7,y+22);ctx.lineTo(x+12,y+15);ctx.lineTo(x+22,y+24);ctx.lineTo(x+27,y+19);ctx.lineTo(x+17,y+10);ctx.lineTo(x+25,y+7);ctx.closePath();ctx.fill();ctx.stroke();if(pulse>0){ctx.shadowBlur=0;ctx.strokeStyle='rgba(229,72,77,'+(1-pulse)+')';ctx.lineWidth=6;ctx.beginPath();ctx.arc(x,y,18+pulse*32,0,Math.PI*2);ctx.stroke()}ctx.restore();resolve()};img.onerror=reject;img.src='data:image/jpeg;base64,'+data});
        window.finishRecording=()=>new Promise(resolve=>{mr.onstop=()=>{const blob=new Blob(chunks,{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='coal-mine-interface-demo.webm';a.click();resolve({size:blob.size,mime})};mr.stop()});
        return {mime,audioCount:Object.keys(buffers).length};
      })()`;
    console.log("Recorder:", await evalRec(recorderSetup));

    let cursor = { x: 960, y: 540 };
    let pulseStart = 0;
    const captureFrame = async () => {
      const shot = await app.send("Page.captureScreenshot", { format:"jpeg", quality:74, fromSurface:true, captureBeyondViewport:false });
      const pulse = pulseStart ? Math.min(1, (Date.now() - pulseStart) / 700) : 0;
      await evalRec(`drawFrame(${JSON.stringify(shot.data)},${cursor.x.toFixed(1)},${cursor.y.toFixed(1)},${pulse})`);
      if (pulse >= 1) pulseStart = 0;
    };
    const center = async (selector) => {
      const s = JSON.stringify(selector);
      const point = await evalApp(`(()=>{const e=document.querySelector(${s});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (!point) throw new Error(`Element not found: ${selector}`);
      return point;
    };
    const moveTo = async (point, duration=420) => {
      const from={...cursor}; const steps=2;
      for(let i=1;i<=steps;i++){const t=i/steps;const ease=t*t*(3-2*t);cursor={x:from.x+(point.x-from.x)*ease,y:from.y+(point.y-from.y)*ease};await app.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:cursor.x,y:cursor.y});await captureFrame();await delay(duration/steps);}
    };
    const click = async (selector) => {
      const p=await center(selector); await moveTo(p); cursor=p;
      await app.send("Input.dispatchMouseEvent",{type:"mousePressed",x:p.x,y:p.y,button:"left",clickCount:1});
      await app.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:p.x,y:p.y,button:"left",clickCount:1});
      pulseStart=Date.now(); await delay(350);
    };
    const typeQuestion = async () => {
      const selector="#questionInput"; const p=await center(selector); await moveTo(p); await click(selector);
      await evalApp("document.querySelector('#questionInput').value='' ");
      const text="某工作面瓦斯浓度连续升高，同时局部通风机运行异常，可能产生哪些风险？";
      let typed=0;
      for(const ch of text){await app.send("Input.insertText",{text:ch});typed++;if(typed%4===0)await captureFrame();await delay(45);}
      await captureFrame();
    };
    const performActions = async (index) => {
      const actions = {
        1: async()=>{await click("#evidenceList .evidence-card:first-child")},
        2: typeQuestion,
        3: async()=>{await click("#analyzeButton");await delay(700);await click("#nodeLayer .graph-node.focus")},
        4: async()=>{await click(".view-button[data-view='timeline']");await delay(450);await click("#timelineEvents .timeline-card:nth-of-type(3)")},
        5: async()=>{await click(".nav-item[data-module='knowledge']");await delay(500);await click(".tool-chip[data-kg-mode='risk']");await click("#kgNodeLayer .kg-node.disaster")},
        6: async()=>{await click(".nav-item[data-module='construction']");await delay(500);await click("[data-build-stage='2']")},
        7: async()=>{await click("[data-construction-view='ontology']");await click("[data-relation-index='3']")},
        8: async()=>{await click("[data-construction-view='triples']");await click("[data-triple-index='3']")},
        9: async()=>{await click("[data-construction-view='fusion']");await click("[data-fusion-method='2']")},
        10:async()=>{await click(".nav-item[data-module='collaboration']");await delay(500);await click("[data-collab-stage='fusion']");await click("[data-collab-view='graph']")},
        11:async()=>{await click("[data-collab-stage='output']");await click("#collabEvidenceList button:nth-child(3)")},
        12:async()=>{await click(".nav-item[data-module='governance']");await delay(500);await click(".source-item[data-source='cases']");await click(".pipeline-stage[data-pipeline-stage='quality']")}
      };
      if (actions[index]) await actions[index]();
    };

    await captureFrame();
    for (let i=0;i<narrations.length;i++) {
      const duration=wavDuration(path.join(outputDir,"audio",`${narrations[i].id}.wav`));
      console.log(`${i+1}/${narrations.length} ${narrations[i].chapter} ${duration.toFixed(2)}s`);
      await evalRec(`playSegment(${i})`);
      const segmentStart=Date.now();
      if (i>0) await performActions(i);
      while (Date.now()-segmentStart < duration*1000) { await captureFrame(); await delay(frameDelay); }
      await delay(180);
    }
    const result=await evalRec("finishRecording()",true); console.log("Recording complete:",result);
    const waitStart=Date.now();
    while(!fs.existsSync(outputFile) && Date.now()-waitStart<60000) await delay(500);
    if(!fs.existsSync(outputFile)) throw new Error("Recorded WebM was not downloaded");
    console.log(`Saved ${outputFile} (${fs.statSync(outputFile).size} bytes)`);
  } finally {
    if (app) app.close(); if (recorder) recorder.close(); edge.kill();
  }
}

main().catch((error)=>{console.error(error.stack||error.message||String(error));process.exitCode=1});
