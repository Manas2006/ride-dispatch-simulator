const canvas = document.querySelector("#map");
const ctx = canvas.getContext("2d");
const feed = document.querySelector("#feed");
const requestRide = document.querySelector("#requestRide");

const bounds = {
  minLat: 37.69,
  maxLat: 37.86,
  minLng: -122.53,
  maxLng: -122.33
};

let snapshot = null;
let lastTrips = new Set();

connect();
requestRide.addEventListener("click", async () => {
  await fetch("/api/request", { method: "POST" });
});

function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") {
      snapshot = message.data;
      renderMetrics(snapshot.metrics);
      renderFeed(snapshot.trips);
      draw();
    }
  });
  socket.addEventListener("close", () => setTimeout(connect, 1200));
}

function renderMetrics(metrics) {
  setText("activeTrips", metrics.activeTrips);
  setText("availableDrivers", metrics.availableDrivers);
  setText("waitingRiders", metrics.waitingRiders);
  setText("averageEta", `${metrics.averageEta}m`);
  setText("p95Dispatch", `${metrics.p95DispatchMs}ms`);
  setText("ratio", metrics.supplyDemandRatio);
}

function renderFeed(trips) {
  const current = new Set(trips.map((trip) => trip.id));
  for (const trip of trips) {
    if (lastTrips.has(trip.id)) continue;
    const item = document.createElement("li");
    item.innerHTML = `<strong>${trip.driverId}</strong> matched ${trip.riderId} with ${trip.surge}x surge`;
    feed.prepend(item);
  }
  while (feed.children.length > 18) feed.lastChild.remove();
  lastTrips = current;
}

function draw() {
  if (!snapshot) return;
  fitCanvas();
  drawGrid();

  for (const cell of snapshot.heatmap) {
    const point = project(cell);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 107, 101, ${Math.min(0.36, cell.intensity / 8)})`;
    ctx.arc(point.x, point.y, 48 + cell.intensity * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const trip of snapshot.trips) {
    const driver = snapshot.drivers.find((item) => item.id === trip.driverId);
    if (!driver) continue;
    drawLine(driver.location, trip.status === "picking_up" ? trip.pickup : trip.dropoff, "#39d98a");
  }

  for (const rider of snapshot.riders) {
    if (rider.status !== "waiting" && rider.status !== "matched") continue;
    drawPoint(rider.pickup, rider.status === "waiting" ? "#ffbd4a" : "#f1f4f2", 5);
  }

  for (const driver of snapshot.drivers) {
    const color = driver.status === "available" ? "#56a8ff" : "#39d98a";
    drawPoint(driver.location, color, driver.status === "available" ? 3 : 5);
  }
}

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function drawGrid() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0d0f10";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(width * 0.18, height * 0.22, width * 0.3, 10);
  ctx.fillRect(width * 0.52, height * 0.62, width * 0.34, 10);
  ctx.fillRect(width * 0.58, height * 0.16, 10, height * 0.48);
  ctx.fillRect(width * 0.28, height * 0.45, 10, height * 0.42);
}

function drawLine(from, to, color) {
  const a = project(from);
  const b = project(to);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPoint(location, color, radius) {
  const point = project(location);
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function project({ lat, lng }) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * width;
  const y = height - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * height;
  return { x, y };
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

window.addEventListener("resize", draw);
