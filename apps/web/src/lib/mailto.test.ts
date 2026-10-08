import { describe, expect, it } from 'vitest';
import { mailtoLink, vendorInfoRequest } from './mailto';

describe('mailtoLink', () => {
  it('addresses one person and starts the message', () => {
    expect(mailtoLink({ to: ['ap@acme.com'], subject: 'W-9 needed', body: 'Hello,\nplease send it.' }))
      .toBe('mailto:ap%40acme.com?subject=W-9%20needed&body=Hello%2C%0Aplease%20send%20it.');
  });

  it('puts several recipients in bcc and skips blanks', () => {
    expect(mailtoLink({ bcc: ['a@x.com', ' ', 'b@y.com'] })).toBe('mailto:?bcc=a%40x.com,b%40y.com');
  });

  it('is a bare mailto when nothing is given', () => {
    expect(mailtoLink({})).toBe('mailto:');
  });
});

describe('vendorInfoRequest', () => {
  it('names the vendor and the company asking', () => {
    const message = vendorInfoRequest('Acme Supply', 'Green Gadgets Inc.');
    expect(message.subject).toBe("Information needed for Green Gadgets Inc.'s records");
    expect(message.body).toContain('Hello Acme Supply,');
    expect(message.body).toContain('Form W-9');
  });

  it('still reads properly with no company name', () => {
    expect(vendorInfoRequest('Acme Supply', null).subject).toBe("Information needed for our company's records");
  });
});
