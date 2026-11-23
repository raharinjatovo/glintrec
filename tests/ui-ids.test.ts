import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', 'src', 'renderer');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

// Renderer scripts that run inside index.html (the other windows have their own pages).
const scripts = ['app.ts', 'ui.ts', 'library-ui.ts'];
function idsUsedBy(file: string): string[] {
  const src = readFileSync(join(dir, file), 'utf8');
  return [...src.matchAll(/(?:\bel|getElementById)(?:<[^>]*>)?\(\s*'([a-z0-9-]+)'\s*\)/g)].map((m) => m[1]);
}

describe('index.html ids', () => {
  it('has no duplicate ids', () => {
    expect(htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i)).toEqual([]);
  });

  it.each(scripts)('defines every id that %s looks up', (file) => {
    const used = idsUsedBy(file);
    if (file === 'ui.ts') expect(used.length).toBeGreaterThan(40);
    expect(used.filter((id) => !htmlIds.includes(id))).toEqual([]);
  });

  it('keeps a script entry and the CSP', () => {
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(readdirSync(dir)).toContain('styles.css');
  });
});
