import { describe, it, expect } from 'vitest';
import { parseCoordinateString } from '@/lib/coords';

describe('parseCoordinateString', () => {
  it('parses Google DMS copy-paste format', () => {
    const r = parseCoordinateString(`53°18'55.8"N 9°51'37.3"E`);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(53.31550, 3);
    expect(r!.lng).toBeCloseTo(9.86036, 3);
  });

  it('parses DMS with extra spaces', () => {
    const r = parseCoordinateString(`53° 18' 55.8" N, 9° 51' 37.3" E`);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(53.31550, 3);
    expect(r!.lng).toBeCloseTo(9.86036, 3);
  });

  it('parses DMS with Unicode primes', () => {
    const r = parseCoordinateString(`53°18′55.8″N 9°51′37.3″E`);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(53.31550, 3);
  });

  it('parses decimal with comma', () => {
    const r = parseCoordinateString('52.4530, 13.2868');
    expect(r).toEqual({ lat: 52.4530, lng: 13.2868 });
  });

  it('parses decimal with whitespace only', () => {
    const r = parseCoordinateString('52.4530 13.2868');
    expect(r).toEqual({ lat: 52.4530, lng: 13.2868 });
  });

  it('handles southern / western hemisphere via N/S/E/W', () => {
    const r = parseCoordinateString(`33°51'31.0"S 151°12'47.0"E`);
    expect(r).not.toBeNull();
    expect(r!.lat).toBeLessThan(0);
    expect(r!.lat).toBeCloseTo(-33.85861, 3);
  });

  it('handles negative decimal signs', () => {
    const r = parseCoordinateString('-33.8589, 151.2128');
    expect(r).toEqual({ lat: -33.8589, lng: 151.2128 });
  });

  it('rejects garbage', () => {
    expect(parseCoordinateString('hello world')).toBeNull();
    expect(parseCoordinateString('Berlin, Germany')).toBeNull();
    expect(parseCoordinateString('')).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(parseCoordinateString('200, 200')).toBeNull();
    expect(parseCoordinateString('-200, -200')).toBeNull();
  });
});
