const { DispatchSimulator } = require("./simulator");

const driverCount = Number(process.env.DRIVERS || 5000);
const requestCount = Number(process.env.REQUESTS || 5000);
const sim = new DispatchSimulator({ driverCount, riderSeedCount: 0 });
const startedAt = performance.now();

for (let i = 0; i < requestCount; i += 1) {
  sim.createRideRequest();
}

const elapsed = performance.now() - startedAt;
const snapshot = sim.snapshot();

console.table({
  drivers: driverCount,
  requests: requestCount,
  matched: snapshot.metrics.matched,
  waiting: snapshot.metrics.waitingRiders,
  elapsedMs: Number(elapsed.toFixed(2)),
  requestsPerSecond: Math.round((requestCount / elapsed) * 1000),
  p95DispatchMs: snapshot.metrics.p95DispatchMs,
  averageEta: snapshot.metrics.averageEta
});
