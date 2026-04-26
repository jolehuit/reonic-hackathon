// Parse a free-form coordinate string into decimal lat/lng.
//
// Supported formats (whitespace + separator flexibility):
//   • Decimal:        "53.31550, 9.86036"
//                     "53.3155 9.8604"
//                     "53.3155°N, 9.8604°E"
//                     "-53.3155, -9.8604"
//   • DMS (Google):   "53°18'55.8\"N 9°51'37.3\"E"
//                     "53° 18' 55.8\" N, 9° 51' 37.3\" E"
//   • DM (with decimal minutes): "53° 18.93' N, 9° 51.62' E"
//
// Returns null if the input doesn't match any format. Doesn't validate
// that the result is on Earth — caller can clamp/check.

export interface ParsedCoords {
  lat: number;
  lng: number;
}

// Accept any of: "°", "º", "deg", or just a digit run (decimal-only input).
const DEG_CHARS = '°ºd';
// Apostrophe variants: ASCII ' (0x27), Unicode prime ′ (0x2032).
const MIN_CHARS = "'′";
// Quote variants: ASCII " (0x22), Unicode double prime ″ (0x2033).
const SEC_CHARS = '"″';

function dmsToDecimal(deg: number, min = 0, sec = 0, sign = 1): number {
  return sign * (Math.abs(deg) + min / 60 + sec / 3600);
}

/** Parse a single component like "53°18'55.8\"N" → 53.31550 */
function parseDmsComponent(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  // Hemisphere indicator: trailing N/S/E/W (or leading +/-).
  let sign = 1;
  let body = trimmed;
  const hemiMatch = body.match(/[NSEW]\s*$/i);
  if (hemiMatch) {
    const h = hemiMatch[0].trim().toUpperCase();
    if (h === 'S' || h === 'W') sign = -1;
    body = body.slice(0, hemiMatch.index).trim();
  } else if (body.startsWith('-')) {
    sign = -1;
    body = body.slice(1).trim();
  } else if (body.startsWith('+')) {
    body = body.slice(1).trim();
  }

  // Degree/min/sec extraction. We're lenient — strip whitespace and let
  // the regex pick up numbers separated by deg/min/sec markers.
  const degRe = new RegExp(
    `^(\\d+(?:\\.\\d+)?)[${DEG_CHARS}]?\\s*` + // degrees
    `(?:(\\d+(?:\\.\\d+)?)[${MIN_CHARS}]?\\s*)?` + // optional minutes
    `(?:(\\d+(?:\\.\\d+)?)[${SEC_CHARS}]?\\s*)?$`, // optional seconds
  );
  const m = body.match(degRe);
  if (!m) return null;

  const deg = parseFloat(m[1]);
  const min = m[2] ? parseFloat(m[2]) : 0;
  const sec = m[3] ? parseFloat(m[3]) : 0;
  if (!Number.isFinite(deg)) return null;

  return dmsToDecimal(deg, min, sec, sign);
}

/** Public entry: takes a free-form string, returns { lat, lng } or null. */
export function parseCoordinateString(input: string): ParsedCoords | null {
  if (!input) return null;
  const cleaned = input.trim();

  // Split on the boundary between the two components. We try common
  // separators in order: comma, semicolon, slash, "by", or whitespace
  // when no other separator is present.
  let parts: string[] = [];
  for (const sep of [/\s*,\s*/, /\s*;\s*/, /\s*\/\s*/, /\s+by\s+/i]) {
    const trial = cleaned.split(sep);
    if (trial.length === 2) {
      parts = trial;
      break;
    }
  }
  if (parts.length !== 2) {
    // Fallback: split on whitespace ONLY when neither half contains an
    // internal space (i.e. simple "lat lng" decimal form).
    const ws = cleaned.split(/\s+/);
    if (ws.length === 2) {
      parts = ws;
    } else if (ws.length === 4) {
      // "53° 18.9' 9° 51.6'" — DM with 2 tokens per component.
      // Heuristic: if there's a hemisphere letter at index 1 or 3, split
      // there. Otherwise give up.
    }
  }

  if (parts.length !== 2) return null;

  const lat = parseDmsComponent(parts[0]);
  const lng = parseDmsComponent(parts[1]);
  if (lat === null || lng === null) return null;

  // Sanity: lat in [-90, 90], lng in [-180, 180].
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { lat, lng };
}
