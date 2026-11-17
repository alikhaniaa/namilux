export type HeaderReader = { get(name: string): string | null };

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;
const IPV6_CHARS_RE = /^[0-9a-f:.]+$/iu;

/** Parses an IPv4 literal into its 32-bit value, or null. */
function ipv4ToInt(ip: string): number | null {
  if (!IPV4_RE.test(ip)) return null;
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

/**
 * Expands an IPv6 literal (RFC 4291 text form, `::` compression, optional embedded IPv4 tail) into
 * eight 16-bit groups, or null when the text is not a valid address.
 */
function ipv6ToGroups(ip: string): number[] | null {
  if (!IPV6_CHARS_RE.test(ip) || !ip.includes(":") || ip.length > 45) return null;
  let text = ip.toLowerCase();
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hex groups.
  const dot = text.lastIndexOf(".");
  if (dot !== -1) {
    const colon = text.lastIndexOf(":");
    const v4 = ipv4ToInt(text.slice(colon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, colon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : (halves[1] ?? "").split(":")) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > (halves.length === 2 ? 7 : 8)) return null;
  const groups: number[] = [];
  for (const g of [...head, ...Array<string>(halves.length === 2 ? 8 - head.length - tail.length : 0).fill("0"), ...tail]) {
    if (!/^[0-9a-f]{1,4}$/u.test(g)) return null;
    groups.push(Number.parseInt(g, 16));
  }
  return groups.length === 8 ? groups : null;
}

function groupsToBigInt(groups: number[]): bigint {
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(g);
  return v;
}

export function normalizeIp(raw: string): string {
  let v = raw.trim();
  if (v === "") return "";
  const bracket = /^\[([^\]]+)\](?::\d{1,5})?$/u.exec(v);
  if (bracket !== null) v = bracket[1] ?? "";
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/u.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (v.toLowerCase().startsWith("::ffff:")) {
    const tail = v.slice(7);
    if (IPV4_RE.test(tail)) return tail;
  }
  if (IPV4_RE.test(v)) return v;
  return ipv6ToGroups(v) === null ? "" : v.toLowerCase();
}

export function clientIpFromHeaders(headers: HeaderReader, trustProxy: boolean): string {
  if (!trustProxy) return "";
  const fwd = headers.get("x-forwarded-for");
  if (fwd !== null) {
    const hops = fwd.split(",").map((s) => normalizeIp(s)).filter((s) => s !== "");
    const last = hops[hops.length - 1];
    if (last !== undefined) return last;
  }
  const real = headers.get("x-real-ip");
  if (real !== null) return normalizeIp(real);
  return "";
}

export function parseCidrList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(/[\s,]+/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function inCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const base = slash === -1 ? cidr : cidr.slice(0, slash);
  const bitsText = slash === -1 ? undefined : cidr.slice(slash + 1);
  const v4Base = ipv4ToInt(base);
  const v4Ip = ipv4ToInt(ip);
  if (v4Base !== null) {
    if (v4Ip === null) return false;
    const bits = bitsText === undefined ? 32 : Number(bitsText);
    if (!/^\d{1,2}$/u.test(bitsText ?? "32") || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((v4Ip & mask) >>> 0) === ((v4Base & mask) >>> 0);
  }
  const v6Base = ipv6ToGroups(base);
  if (v6Base === null) return false;
  // An IPv4 client may be listed as a ::ffff:a.b.c.d/N range.
  const v6Ip = v4Ip !== null ? ipv6ToGroups(`::ffff:${ip}`) : ipv6ToGroups(ip);
  if (v6Ip === null) return false;
  const bits = bitsText === undefined ? 128 : Number(bitsText);
  if (!/^\d{1,3}$/u.test(bitsText ?? "128") || bits < 0 || bits > 128) return false;
  const shift = BigInt(128 - bits);
  return groupsToBigInt(v6Ip) >> shift === groupsToBigInt(v6Base) >> shift;
}

export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const norm = normalizeIp(ip);
  if (norm === "") return false;
  return cidrs.some((c) => inCidr(norm, c.trim()));
}
