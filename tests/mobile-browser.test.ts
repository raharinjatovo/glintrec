import { describe, expect, it } from 'vitest';
import {
  BAR_HEIGHT, isAllowedNavigation, normalizeAddress, pageBounds, parseCommand, SEARCH_URL, windowSizeFor,
} from '../src/shared/mobile-browser';

describe('normalizeAddress', () => {
  it('keeps http(s) URLs', () => {
    expect(normalizeAddress('https://example.com/a?b=1')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(normalizeAddress('  http://example.com  ')).toEqual({ kind: 'url', url: 'http://example.com/' });
    expect(normalizeAddress('HTTPS://Example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
  });
  it('adds https:// to bare hosts, http:// to localhost and IPs', () => {
    expect(normalizeAddress('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(normalizeAddress('m.example.co.uk/path?x=1')).toEqual({ kind: 'url', url: 'https://m.example.co.uk/path?x=1' });
    expect(normalizeAddress('localhost:3000')).toEqual({ kind: 'url', url: 'http://localhost:3000/' });
    expect(normalizeAddress('localhost')).toEqual({ kind: 'url', url: 'http://localhost/' });
    expect(normalizeAddress('192.168.1.10:8080/x')).toEqual({ kind: 'url', url: 'http://192.168.1.10:8080/x' });
    expect(normalizeAddress('example.com:8443')).toEqual({ kind: 'url', url: 'https://example.com:8443/' });
  });
  it('turns plain text into a search', () => {
    expect(normalizeAddress('hello')).toEqual({ kind: 'search', url: `${SEARCH_URL}hello` });
    expect(normalizeAddress('meteo paris & co')).toEqual({ kind: 'search', url: `${SEARCH_URL}meteo%20paris%20%26%20co` });
    expect(normalizeAddress('what is 3.14')).toEqual({ kind: 'search', url: `${SEARCH_URL}what%20is%203.14` });
    expect(normalizeAddress('999.1.1.1')).toMatchObject({ kind: 'search' });
    expect(normalizeAddress('me@example.com')).toMatchObject({ kind: 'search' });
    expect(normalizeAddress('note: buy milk')).toMatchObject({ kind: 'search' });
  });
  it('rejects dangerous schemes and junk', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/x', 'about:blank',
      'blob:https://a/b', 'ftp://example.com', 'chrome://settings', 'view-source:https://a.com', '//evil.com', 'https://user:pw@a.com',
      'http://', '', '   ', 'a\\b.com', 'x\u0000y']) {
      expect(normalizeAddress(bad), bad).toBeNull();
    }
    expect(normalizeAddress(42)).toBeNull();
    expect(normalizeAddress('a'.repeat(3000))).toBeNull();
  });
});

describe('isAllowedNavigation', () => {
  it('allows http(s) only', () => {
    expect(isAllowedNavigation('https://a.com/x')).toBe(true);
    expect(isAllowedNavigation('http://localhost:3000')).toBe(true);
    for (const bad of ['file:///x', 'javascript:1', 'data:text/html,1', 'about:blank', 'app://local/x', 'nope', '', 'https://u:p@a.com', null, 5]) {
      expect(isAllowedNavigation(bad), String(bad)).toBe(false);
    }
  });
});

describe('windowSizeFor', () => {
  it('uses 396x704 when there is room and keeps 9:16 exactly', () => {
    expect(windowSizeFor({ width: 1920, height: 1040 })).toEqual({ width: 396, height: 704 });
  });
  it('shrinks to fit a small work area, ratio stays exact', () => {
    const s = windowSizeFor({ width: 1366, height: 728 }, undefined, { width: 16, height: 39 });
    expect(s.width * 16).toBe(s.height * 9);
    expect(s.height + 39).toBeLessThanOrEqual(728 * 0.9);
    expect(s.height).toBeLessThan(704);
  });
  it('never goes below a usable minimum', () => {
    const s = windowSizeFor({ width: 100, height: 100 });
    expect(s).toEqual({ width: 180, height: 320 });
  });
  it('page view fills the content below the bar', () => {
    expect(pageBounds({ width: 396, height: 704 })).toEqual({ x: 0, y: BAR_HEIGHT, width: 396, height: 704 - BAR_HEIGHT });
  });
});

describe('parseCommand', () => {
  it('validates bar messages', () => {
    expect(parseCommand({ type: 'navigate', text: 'a.com' })).toEqual({ type: 'navigate', text: 'a.com' });
    expect(parseCommand({ type: 'back' })).toEqual({ type: 'back' });
    expect(parseCommand({ type: 'home', extra: 1 })).toEqual({ type: 'home' });
    expect(parseCommand({ type: 'navigate', text: 5 })).toBeNull();
    expect(parseCommand({ type: 'eval' })).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });
});
