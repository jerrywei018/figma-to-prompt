import { describe, expect, it } from 'vitest';
import { dataUrlToText } from '../src/ui/download';

describe('download helpers', () => {
  it('decodes URL-encoded SVG data URLs to raw text', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1V1Z"/></svg>';
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    expect(dataUrlToText(dataUrl)).toBe(svg);
  });

  it('decodes base64 SVG data URLs to raw text', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1V1Z"/></svg>';
    const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;

    expect(dataUrlToText(dataUrl)).toBe(svg);
  });
});
