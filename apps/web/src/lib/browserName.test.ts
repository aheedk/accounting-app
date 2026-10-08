import { describe, expect, it } from 'vitest';
import { describeBrowser } from './browserName';

describe('describeBrowser', () => {
  it('names the browser and the system', () => {
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0')).toBe('Edge on Windows');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('Safari on Mac');
    expect(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox on Linux');
    expect(describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone or iPad');
  });

  it('copes with nothing, and with something it does not know', () => {
    expect(describeBrowser(null)).toBe('Unknown browser');
    expect(describeBrowser('curl/8.4.0')).toBe('A browser');
  });
});
