/**
 * A link that opens the user's own mail program with a message started.
 * The app has no mail service of its own yet, so this is how it "sends".
 * Several recipients go in `bcc` so they do not see each other's addresses.
 */
export function mailtoLink(opts: { to?: string[]; bcc?: string[]; subject?: string; body?: string }): string {
  const addresses = (list: string[] | undefined) => (list ?? []).map(a => a.trim()).filter(Boolean).map(encodeURIComponent).join(',');
  const params: string[] = [];
  const bcc = addresses(opts.bcc);
  if (bcc) params.push(`bcc=${bcc}`);
  if (opts.subject) params.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) params.push(`body=${encodeURIComponent(opts.body)}`);
  return `mailto:${addresses(opts.to)}${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

/** The message "Ask vendor for info" starts: what a new vendor's record needs. */
export function vendorInfoRequest(vendorName: string, companyName: string | null): { subject: string; body: string } {
  const from = companyName ?? 'our company';
  return {
    subject: `Information needed for ${from}'s records`,
    body: [
      `Hello ${vendorName},`,
      '',
      `So that ${from} can pay you correctly and on time, please reply with:`,
      '',
      '- Your legal business name and mailing address',
      '- A completed Form W-9 (tax ID)',
      '- Who to contact about invoices, with a phone number',
      '- How you would like to be paid, and your payment terms',
      '',
      'Thank you.',
    ].join('\n'),
  };
}
