const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DispatchSimulator } = require("./simulator");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const simulator = new DispatchSimulator();
const sockets = new Set();

const server = http.createServer((req, res) => {
  if (req.url === "/api/snapshot") {
    return json(res, simulator.snapshot());
  }

  if (req.url === "/api/request" && req.method === "POST") {
    return readBody(req, (body) => {
      const payload = body ? JSON.parse(body) : {};
      json(res, simulator.createRideRequest(payload));
    });
  }

  const filePath = req.url === "/" ? "/index.html" : req.url;
  serveStatic(filePath, res);
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "",
      ""
    ].join("\r\n")
  );

  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
  send(socket, { type: "snapshot", data: simulator.snapshot() });
});

setInterval(() => {
  const snapshot = simulator.tick();
  broadcast({ type: "snapshot", data: snapshot });
}, 1000);

server.listen(PORT, () => {
  console.log(`Ride Dispatch Simulator running at http://localhost:${PORT}`);
});

function json(res, data) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => callback(body));
}

function serveStatic(filePath, res) {
  const safePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, safePath);

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": contentType(fullPath) });
    res.end(content);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "text/html";
}

function broadcast(payload) {
  for (const socket of sockets) {
    send(socket, payload);
  }
}

function send(socket, payload) {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  const header =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x81, 126, body.length >> 8, body.length & 0xff]);
  socket.write(Buffer.concat([header, body]));
}
