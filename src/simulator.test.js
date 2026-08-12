const assert = require("node:assert");
const { haversineKm, estimateEtaMinutes } = require("./geo");
const { DispatchSimulator, STATUS } = require("./simulator");

function testDistance() {
  const sf = { lat: 37.7749, lng: -122.4194 };
  const oakland = { lat: 37.8044, lng: -122.2711 };
  const distance = haversineKm(sf, oakland);
  assert(distance > 13 && distance < 15, `expected SF to Oakland to be about 13.5km, got ${distance}`);
  assert.strictEqual(estimateEtaMinutes({ valueOf: () => 0 }), 1);
}

function testMatching() {
  const sim = new DispatchSimulator({ driverCount: 0, riderSeedCount: 0 });
  const driver = sim.createDriver();
  driver.location = { lat: 37.7749, lng: -122.4194 };
  const rider = sim.createRideRequest({
    pickup: { lat: 37.775, lng: -122.4195 },
    dropoff: { lat: 37.789, lng: -122.401 }
  }).rider;

  assert.strictEqual(rider.status, "matched");
  assert.strictEqual(driver.status, STATUS.PICKING_UP);
  assert.strictEqual(sim.metrics.matched, 1);
}

function testProgression() {
  const sim = new DispatchSimulator({ driverCount: 1, riderSeedCount: 0 });
  const driver = [...sim.drivers.values()][0];
  driver.location = { lat: 37.7749, lng: -122.4194 };
  const { rider } = sim.createRideRequest({
    pickup: { lat: 37.77491, lng: -122.41941 },
    dropoff: { lat: 37.77492, lng: -122.41942 }
  });

  for (let i = 0; i < 10; i += 1) sim.tick();
  assert(["on_trip", "completed"].includes(rider.status), `unexpected rider status ${rider.status}`);
}

testDistance();
testMatching();
testProgression();
console.log("All simulator tests passed");
