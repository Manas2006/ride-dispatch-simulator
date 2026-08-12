const { haversineKm, estimateEtaMinutes, jitter, moveToward } = require("./geo");

const CENTER = { lat: 37.7749, lng: -122.4194 };
const STATUS = {
  AVAILABLE: "available",
  MATCHED: "matched",
  PICKING_UP: "picking_up",
  ON_TRIP: "on_trip"
};

class DispatchSimulator {
  constructor({ driverCount = 180, riderSeedCount = 22 } = {}) {
    this.clock = 0;
    this.drivers = new Map();
    this.riders = new Map();
    this.trips = new Map();
    this.metrics = {
      requests: 0,
      matched: 0,
      cancelled: 0,
      completed: 0,
      averageEta: 0,
      p95DispatchMs: 0,
      lastDispatchMs: 0
    };

    for (let i = 0; i < driverCount; i += 1) {
      this.createDriver();
    }
    for (let i = 0; i < riderSeedCount; i += 1) {
      this.createRideRequest();
    }
  }

  createDriver() {
    const id = `drv_${this.drivers.size + 1}`;
    const driver = {
      id,
      status: STATUS.AVAILABLE,
      location: randomPoint(),
      target: null,
      riderId: null,
      rating: Number((4.65 + Math.random() * 0.35).toFixed(2))
    };
    this.drivers.set(id, driver);
    return driver;
  }

  createRideRequest(payload = {}) {
    const id = `rdr_${this.riders.size + 1}`;
    const pickup = payload.pickup || randomPoint();
    const dropoff = payload.dropoff || randomPoint();
    const rider = {
      id,
      pickup,
      dropoff,
      status: "waiting",
      createdAt: Date.now(),
      matchedDriverId: null,
      etaMinutes: null,
      surge: this.getSurgeForPoint(pickup)
    };
    this.riders.set(id, rider);
    this.metrics.requests += 1;
    const match = this.matchRider(id);
    return { rider, match };
  }

  matchRider(riderId) {
    const rider = this.riders.get(riderId);
    if (!rider || rider.status !== "waiting") return null;

    const startedAt = performance.now();
    const candidates = [...this.drivers.values()]
      .filter((driver) => driver.status === STATUS.AVAILABLE)
      .map((driver) => {
        const distanceKm = haversineKm(driver.location, rider.pickup);
        const etaMinutes = estimateEtaMinutes(distanceKm);
        const score = distanceKm * 0.7 + etaMinutes * 0.25 - driver.rating * 0.08;
        return { driver, distanceKm, etaMinutes, score };
      })
      .filter((candidate) => candidate.distanceKm <= 8)
      .sort((a, b) => a.score - b.score);

    const dispatchMs = performance.now() - startedAt;
    this.metrics.lastDispatchMs = Math.round(dispatchMs * 100) / 100;
    this.updateP95Dispatch(dispatchMs);

    const best = candidates[0];
    if (!best) return null;

    best.driver.status = STATUS.PICKING_UP;
    best.driver.target = rider.pickup;
    best.driver.riderId = rider.id;

    rider.status = "matched";
    rider.matchedDriverId = best.driver.id;
    rider.etaMinutes = best.etaMinutes;

    const tripId = `trip_${this.trips.size + 1}`;
    this.trips.set(tripId, {
      id: tripId,
      riderId: rider.id,
      driverId: best.driver.id,
      status: STATUS.PICKING_UP,
      pickup: rider.pickup,
      dropoff: rider.dropoff,
      surge: rider.surge,
      startedAt: Date.now()
    });

    this.metrics.matched += 1;
    this.metrics.averageEta = rollingAverage(
      this.metrics.averageEta,
      best.etaMinutes,
      this.metrics.matched
    );

    return {
      tripId,
      driverId: best.driver.id,
      riderId: rider.id,
      etaMinutes: best.etaMinutes,
      distanceKm: Number(best.distanceKm.toFixed(2)),
      surge: rider.surge
    };
  }

  tick() {
    this.clock += 1;

    for (const driver of this.drivers.values()) {
      if (driver.target) {
        driver.location = moveToward(driver.location, driver.target, 0.12);
        if (haversineKm(driver.location, driver.target) < 0.08) {
          this.advanceDriver(driver);
        }
      } else if (driver.status === STATUS.AVAILABLE) {
        driver.location = jitter(driver.location);
      }
    }

    if (Math.random() < 0.35) {
      this.createRideRequest();
    }

    for (const rider of this.riders.values()) {
      if (rider.status === "waiting") {
        this.matchRider(rider.id);
      }
      if (rider.status === "waiting" && Date.now() - rider.createdAt > 60000) {
        rider.status = "cancelled";
        this.metrics.cancelled += 1;
      }
    }

    return this.snapshot();
  }

  advanceDriver(driver) {
    const trip = [...this.trips.values()].find(
      (item) => item.driverId === driver.id && item.status !== "completed"
    );
    if (!trip) {
      driver.status = STATUS.AVAILABLE;
      driver.target = null;
      driver.riderId = null;
      return;
    }

    if (trip.status === STATUS.PICKING_UP) {
      trip.status = STATUS.ON_TRIP;
      driver.status = STATUS.ON_TRIP;
      driver.target = trip.dropoff;
      const rider = this.riders.get(trip.riderId);
      if (rider) rider.status = "on_trip";
      return;
    }

    trip.status = "completed";
    trip.completedAt = Date.now();
    driver.status = STATUS.AVAILABLE;
    driver.target = null;
    driver.riderId = null;
    const rider = this.riders.get(trip.riderId);
    if (rider) rider.status = "completed";
    this.metrics.completed += 1;
  }

  getSurgeForPoint(point) {
    const nearbyDrivers = [...this.drivers.values()].filter(
      (driver) => driver.status === STATUS.AVAILABLE && haversineKm(driver.location, point) < 2
    ).length;
    const nearbyRiders = [...this.riders.values()].filter(
      (rider) => rider.status === "waiting" && haversineKm(rider.pickup, point) < 2
    ).length;
    const ratio = nearbyRiders / Math.max(1, nearbyDrivers);
    return Number(Math.min(2.8, Math.max(1, 1 + ratio * 0.45)).toFixed(2));
  }

  updateP95Dispatch(dispatchMs) {
    this.dispatchSamples = this.dispatchSamples || [];
    this.dispatchSamples.push(dispatchMs);
    if (this.dispatchSamples.length > 300) this.dispatchSamples.shift();
    const sorted = [...this.dispatchSamples].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    this.metrics.p95DispatchMs = Number((sorted[index] || 0).toFixed(2));
  }

  snapshot() {
    const drivers = [...this.drivers.values()];
    const riders = [...this.riders.values()];
    const activeTrips = [...this.trips.values()].filter(
      (trip) => trip.status !== "completed"
    );
    const availableDrivers = drivers.filter((driver) => driver.status === STATUS.AVAILABLE);
    const waitingRiders = riders.filter((rider) => rider.status === "waiting");

    return {
      clock: this.clock,
      drivers,
      riders: riders.slice(-80),
      trips: activeTrips.slice(-80),
      heatmap: this.buildHeatmap(waitingRiders),
      metrics: {
        ...this.metrics,
        activeTrips: activeTrips.length,
        availableDrivers: availableDrivers.length,
        waitingRiders: waitingRiders.length,
        supplyDemandRatio: Number(
          (availableDrivers.length / Math.max(1, waitingRiders.length)).toFixed(2)
        )
      }
    };
  }

  buildHeatmap(waitingRiders) {
    const buckets = new Map();
    for (const rider of waitingRiders) {
      const key = `${Math.round((rider.pickup.lat - 37.7) * 100)}:${Math.round(
        (rider.pickup.lng + 122.52) * 100
      )}`;
      buckets.set(key, (buckets.get(key) || 0) + rider.surge);
    }
    return [...buckets.entries()].map(([key, intensity]) => {
      const [latIndex, lngIndex] = key.split(":").map(Number);
      return {
        lat: 37.7 + latIndex / 100,
        lng: -122.52 + lngIndex / 100,
        intensity: Number(intensity.toFixed(2))
      };
    });
  }
}

function randomPoint() {
  return {
    lat: CENTER.lat + (Math.random() - 0.5) * 0.14,
    lng: CENTER.lng + (Math.random() - 0.5) * 0.18
  };
}

function rollingAverage(current, next, count) {
  return Number((((current * (count - 1)) + next) / count).toFixed(2));
}

module.exports = {
  DispatchSimulator,
  STATUS
};
