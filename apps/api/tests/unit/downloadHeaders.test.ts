import { describe, it, expect } from 'vitest';
import { downloadHeaders } from '../../src/services/files/fileService.js';

describe('downloadHeaders', () => {
  it('shows PDFs, images and text in the browser', () => {
    expect(downloadHeaders('application/pdf', 'receipt.pdf')).toEqual({ type: 'application/pdf', disposition: 'inline; filename="receipt.pdf"' });
    expect(downloadHeaders('IMAGE/PNG', 'stub.png').type).toBe('image/png');
    expect(downloadHeaders('text/plain; charset=utf-8', 'notes.txt').type).toBe('text/plain');
  });

  it('sends anything that could run script, or is unknown, as a plain download', () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/javascript', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
      expect(downloadHeaders(mime, 'x')).toEqual({ type: 'application/octet-stream', disposition: 'attachment; filename="x"' });
    }
  });

  it('keeps a quote in the file name from breaking the header', () => {
    expect(downloadHeaders('application/pdf', 'a"b.pdf').disposition).toBe('inline; filename="a%22b.pdf"');
  });
});
