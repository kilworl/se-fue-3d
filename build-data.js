// Merges the real barrio geometry (data.js) with the live outages snapshot
// downloaded from se-fue.vercel.app into one compact GeoJSON file the map loads.
const fs = require('fs');

const rawGeo = fs.readFileSync('data/barrios-data.js', 'utf8');
const sandbox = { window: {} };
new Function('window', rawGeo)(sandbox.window);
const geo = sandbox.window.SEFUE;

const outagesDoc = JSON.parse(fs.readFileSync('data/outages-snapshot.json', 'utf8'));
const outagesByBarrio = new Map(outagesDoc.barrios.map(b => [b.id, b]));

function metersToDegLat(m) { return m / 111320; }
function metersToDegLng(m, lat) { return m / (111320 * Math.cos(lat * Math.PI / 180)); }

function squareRing(lat, lng, radiusM) {
  const dLat = metersToDegLat(radiusM), dLng = metersToDegLng(radiusM, lat);
  return [
    [lng - dLng, lat - dLat], [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat], [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat]
  ];
}

function toGeoJsonMultiPolygon(polygon) {
  // source: [[[[lat,lng], ...]]]  ->  GeoJSON: [[[ [lng,lat], ... ]]]
  return polygon.map(poly => poly.map(ring => ring.map(([lat, lng]) => [lng, lat])));
}

let counts = { agua: 0, luz: 0, ambos: 0, ok: 0 };
let withPolygon = 0, withPoint = 0;
const features = [];

for (const b of geo.barrios) {
  const live = outagesByBarrio.get(b.id);
  let agua = false, luz = false, reason = null, since = null;
  if (live) {
    for (const o of (live.outages || [])) {
      if (o.status !== 'activo') continue;
      if (o.utility === 'agua') agua = true;
      if (o.utility === 'luz') luz = true;
      if (!reason || new Date(o.start) < new Date(since)) { reason = o.reason; since = o.start; }
    }
  }
  const status = agua && luz ? 'ambos' : agua ? 'agua' : luz ? 'luz' : 'ok';
  counts[status]++;

  let geometry;
  if (b.polygon) {
    geometry = { type: 'MultiPolygon', coordinates: toGeoJsonMultiPolygon(b.polygon) };
    withPolygon++;
  } else {
    geometry = { type: 'Polygon', coordinates: [squareRing(b.lat, b.lng, 90)] };
    withPoint++;
  }

  features.push({
    type: 'Feature',
    geometry,
    properties: {
      id: b.id,
      name: b.name,
      zone: b.zone || '',
      hint: b.hint || '',
      status,
      reason: reason ? reason.slice(0, 220) : null,
      since,
      hasPolygon: !!b.polygon,
      lat: b.lat,
      lng: b.lng
    }
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: outagesDoc.updatedAt,
  sources: outagesDoc.sources,
  disclaimer: outagesDoc.disclaimer,
  counts,
  featureCollection: { type: 'FeatureCollection', features }
};

fs.writeFileSync('barrios.merged.json', JSON.stringify(out));
console.log('barrios total:', geo.barrios.length, 'withPolygon:', withPolygon, 'withPoint(buffered):', withPoint);
console.log('counts:', counts);
console.log('sourceUpdatedAt:', outagesDoc.updatedAt, 'disclaimer:', outagesDoc.disclaimer);
