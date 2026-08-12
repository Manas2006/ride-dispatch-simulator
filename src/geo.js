const EARTH_RADIUS_KM = 6371;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function estimateEtaMinutes(distanceKm, speedKph = 28) {
  return Math.max(1, Math.round((distanceKm / speedKph) * 60));
}

function moveToward(origin, target, step = 0.08) {
  return {
    lat: origin.lat + (target.lat - origin.lat) * step,
    lng: origin.lng + (target.lng - origin.lng) * step
  };
}

function jitter(point, amount = 0.0018) {
  return {
    lat: point.lat + (Math.random() - 0.5) * amount,
    lng: point.lng + (Math.random() - 0.5) * amount
  };
}

module.exports = {
  haversineKm,
  estimateEtaMinutes,
  moveToward,
  jitter
};
