// Azure App Service writes the visitor's address into X-Forwarded-For with the
// port it came from ("203.0.113.7:51234"). Express takes the entry whole as
// req.ip, so every connection would look like a new address to the sign-in
// limit, and the audit log's inet column refuses it, failing every audited
// request (sign-in included). This drops the port from each entry and leaves
// anything else (Railway's plain addresses, IPv6) as it is.
export function stripForwardedPorts(header: string): string {
  return header.split(',').map(part => {
    const entry = part.trim();
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry); // [2001:db8::1]:443
    if (bracketed) return bracketed[1]!;
    const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(entry); // 203.0.113.7:51234
    if (v4) return v4[1]!;
    return entry;
  }).join(', ');
}
