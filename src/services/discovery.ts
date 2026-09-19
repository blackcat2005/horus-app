/**
 * Discovery Service — tự tìm server trên cùng mạng LAN qua mDNS/Bonjour.
 * Server quảng bá service `_multicam._tcp` (bonjour-service) kèm txt `ips`
 * (toàn bộ IP local). App dùng react-native-zeroconf quét, sau đó:
 *   1. lọc IP chính điện thoại (expo-network),
 *   2. probe GET <ip>:<http_port>/health trên từng IP (host/addresses/txt.ips)
 *      — chỉ server thật (có health endpoint) mới xuất hiện, IP ưu tiên là
 *      cái nào phản hồi được từ subnet của phone.
 */

import { Platform } from 'react-native';
import { logger } from '../utils/logger';
import type { LanRoom } from '../api/rooms';
import { serverConfigService } from './serverConfig';

export const DISCOVERY_SERVICE_TYPE = 'multicam'; // server type -> _multicam._tcp.local
export const DISCOVERY_DOMAIN = 'local.';

export interface DiscoveredServer {
  /** Zeroconf name (vd "Multicam-192.168.1.100@hisu") */
  name: string;
  /** IP đã được xác minh bằng /health (có thể khác IP advertise nếu nhiều NIC) */
  host: string;
  /** Port từ SRV record (HTTP port của server) */
  port: number;
  /** Danh sách IP ứng viên (host/addresses/txt.ips) */
  addresses: string[];
  /** TXT record: { server_name, version, api_prefix, protocol, ips } */
  txt: Record<string, string>;
  /** Các phòng đang "mở trên LAN" lấy từ GET /rooms/discover (public) */
  rooms?: LanRoom[];
}

type ZeroconfLike = {
  scan: (type: string, protocol?: string, domain?: string) => void;
  stop: () => void;
  on: (event: string, callback: (service: any) => void) => void;
};

function parseTxt(txt: unknown): Record<string, string> {
  if (!txt || typeof txt !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(txt as Record<string, unknown>)) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
}

/** IP của chính điện thoại (để loại khỏi danh sách ứng viên). */
async function getOwnIPv4(): Promise<string | null> {
  try {
    const mod = await import('expo-network');
    const ip = await (mod as any).getIpAddressAsync();
    return typeof ip === 'string' && ip.length > 0 ? ip : null;
  } catch (err) {
    logger.warn('Cannot read own IP (expo-network unavailable)', err);
    return null;
  }
}

/** Probe GET /health — chỉ server Multicam đang chạy mới trả code 1000 status up. */
async function isServerAlive(ip: string, port: number, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${ip}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.code === 1000 && body?.data?.status === 'up';
  } catch {
    return false;
  }
}

/** Lấy danh sách phòng đang "mở trên LAN" (GET /rooms/discover — public, không cần auth). */
export async function fetchLanRooms(
  ip: string,
  port: number,
  txt: Record<string, string>,
  timeoutMs = 3000,
): Promise<LanRoom[] | undefined> {
  try {
    const apiPrefix = txt?.api_prefix || '/it4788/api/v1';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${ip}:${port}${apiPrefix}/rooms/discover`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const body = await res.json().catch(() => null);
    const list = body?.data;
    if (!Array.isArray(list)) return undefined;
    const rooms: LanRoom[] = [];
    for (const r of list) {
      if (r && typeof r.invite_code === 'string' && r.invite_code) {
        rooms.push({
          room_id: r.room_id ?? null,
          room_name: r.room_name ?? null,
          invite_code: r.invite_code,
          auto_approve: Number(r.auto_approve ?? 1) === 0 ? 0 : 1,
          member_count: Number(r.member_count ?? 0),
        });
      }
    }
    return rooms;
  } catch (err) {
    logger.warn('fetchLanRooms failed', err);
    return undefined;
  }
}

/** Gom các IP ứng viên của một service, bỏ loopback/link-local. */
function candidateAddresses(svc: DiscoveredServer): string[] {
  const set = new Set<string>();
  if (svc.host) set.add(svc.host);
  for (const addr of svc.addresses) if (addr) set.add(addr);
  const txtIps = String(svc.txt?.ips ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  for (const ip of txtIps) set.add(ip);
  return [...set].filter(ip => {
    if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;
    if (ip.startsWith('169.254.')) return false; // link-local
    return true;
  });
}

/** Port HTTP mặc định của server (nếu chạy custom port thì sweep thêm port đã lưu). */
const LAN_SCAN_PORTS = [3000];

/** IP hợp lệ để probe (bỏ loopback/link-local/multicast). */
function ipOk(ip: string): boolean {
  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;
  if (ip.startsWith('169.254.')) return false; // link-local
  return true;
}

/** Trả về .1–.254 trong cùng /24 với phone (bỏ IP chính phone). */
function lanIpRange(own: string): string[] {
  const parts = own.split('.');
  if (parts.length !== 4) return [];
  const ownLast = Number(parts[3]);
  if (!Number.isFinite(ownLast)) return [];
  const base = parts.slice(0, 3).join('.');
  const out: string[] = [];
  for (let i = 1; i <= 254; i++) {
    if (i !== ownLast) out.push(`${base}.${i}`);
  }
  return out;
}

/**
 * Quét mạch TCP toàn subnet: probe GET /health từng IP x từng port, có giới hạn
 * đồng thời để không quá tải. Unicast nên KHÔNG phụ thuộc mDNS multicast
 * (vốn chập chờn trên WiFi thật).
 */
async function sweepLan(
  ips: string[],
  ports: number[],
  timeoutMs: number,
): Promise<{ ip: string; port: number }[]> {
  const jobs: { ip: string; port: number }[] = [];
  for (const ip of ips) for (const port of ports) jobs.push({ ip, port });
  const alive: { ip: string; port: number }[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(24, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (job && (await isServerAlive(job.ip, job.port, timeoutMs))) {
        alive.push(job);
      }
    }
  });
  await Promise.all(workers);
  return alive;
}

// Zeroconf singleton: Android không cho tạo nhiều browser cùng lúc — lần quét 2
// sẽ tịt nếu instance cũ chưa được thả socket. Dùng 1 instance, stop trước mỗi
// lần scan và đợi một nhịp để socket multicast cũ được giải phóng.
let zc: ZeroconfLike | null = null;
const mdnsResults = new Map<string, DiscoveredServer>();

async function getZeroconf(): Promise<ZeroconfLike | null> {
  if (zc) return zc;
  try {
    const mod = await import('react-native-zeroconf');
    const Zeroconf: { new (): ZeroconfLike } = (mod as any).default ?? (mod as any);
    zc = new Zeroconf();
    zc.on('resolved', (service: any) => {
      if (!service) return;
      const addresses: string[] = Array.isArray(service.addresses)
        ? service.addresses.map(String)
        : [];
      const host = String(service.host ?? addresses[0] ?? '');
      const port = Number(service.port ?? 0);
      const name = String(service.fullName ?? service.name ?? '');
      const txt = parseTxt(service.txt);
      if (!host || !port) return;
      mdnsResults.set(`${host}:${port}`, { name, host, port, addresses, txt });
    });
    zc.on('found', () => {});
    zc.on('error', (err: any) => {
      logger.warn('Zeroconf error', err);
    });
    return zc;
  } catch (err) {
    logger.error('react-native-zeroconf unavailable (đã rebuild dev client chưa?)', err);
    return null;
  }
}

/** Bước 1: quét mDNS (zeroconf) — tốt khi có, không tin tưởng 100%. */
async function scanMdns(timeoutMs: number): Promise<DiscoveredServer[]> {
  const z = await getZeroconf();
  if (!z) return [];
  mdnsResults.clear();
  try {
    z.stop();
  } catch {}
  // Nhịp chờ socket multicast cũ được thả (Android hay trả EADDRINUSE nếu quét gấp).
  await new Promise(r => setTimeout(r, 500));

  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      try {
        z.stop();
      } catch {}
      resolve();
    }, timeoutMs);

    try {
      z.scan(DISCOVERY_SERVICE_TYPE, 'tcp', DISCOVERY_DOMAIN);
    } catch (err) {
      logger.error('Zeroconf scan failed to start', err);
      clearTimeout(timer);
      resolve();
    }
  });

  try {
    z.stop();
  } catch {}
  return [...mdnsResults.values()];
}

/**
 * Quét server Multicam trên LAN bằng NHIỀU nguồn (mDNS + sweep TCP /24) — không
 * phụ thuộc riêng mDNS vốn hay mất gói trên WiFi. Server kết quả đều đã được
 * xác minh /health và kèm danh sách phòng mở (GET /rooms/discover, public).
 */
export async function discoverServers(timeoutMs = 5000): Promise<DiscoveredServer[]> {
  if (Platform.OS === 'web') {
    logger.warn('Discovery not supported on web');
    return [];
  }

  const own = await getOwnIPv4();
  const ownFilter = (ip: string) => (own ? ip !== own : true);

  // Nguồn 1: mDNS (zeroconf)
  const mdns = await scanMdns(timeoutMs);
  logger.info(`Discovery mDNS: ${mdns.length} service(s)`);

  // Nguồn 2: sweep TCP /24 (chắc chắn nếu server chạy cùng subnet).
  const swept: DiscoveredServer[] = [];
  if (own) {
    const ips = lanIpRange(own).filter(ipOk);
    const saved = await serverConfigService.load().catch(() => null);
    const ports = new Set<number>(LAN_SCAN_PORTS);
    const savedPort = Number(saved?.port);
    if (Number.isInteger(savedPort) && savedPort > 0) ports.add(savedPort);
    const alivePorts = [...ports];
    const hits = await sweepLan(ips, alivePorts, 900);
    for (const h of hits) {
      // Sweep đã xác minh /health nên không cần re-probe ở bước sau.
      swept.push({
        name: `Multicam-${h.ip}`,
        host: h.ip,
        port: h.port,
        addresses: [h.ip],
        txt: {},
      });
    }
    logger.info(`Discovery TCP sweep(/24): ${hits.length} alive`);
  }

  // Gộp dedupe theo host:port — ưu tiên entry mDNS (có txt đầy đủ hơn).
  const merged = new Map<string, DiscoveredServer>();
  for (const s of [...swept, ...mdns]) {
    if (s.host && s.port) merged.set(`${s.host}:${s.port}`, s);
  }

  const skipProbe = new Set<string>(swept.map(s => `${s.host}:${s.port}`));
  const verified: DiscoveredServer[] = [];

  for (const svc of merged.values()) {
    const candidates = candidateAddresses(svc).filter(ip => ipOk(ip) && ownFilter(ip));
    if (candidates.length === 0) continue;
    if (skipProbe.has(`${svc.host}:${svc.port}`)) {
      verified.push({ ...svc, host: svc.host, addresses: candidates });
      continue;
    }
    const checks = await Promise.all(
      candidates.map(async ip => ({ ip, ok: await isServerAlive(ip, svc.port) })),
    );
    const alive = checks.find(c => c.ok);
    if (alive) {
      verified.push({ ...svc, host: alive.ip, addresses: candidates });
      logger.info(`Discovery verified (mDNS) ${alive.ip}:${svc.port} (${svc.name})`);
    } else {
      logger.info(`Discovery skip (health probe failed) ${svc.name}`);
    }
  }

  // Lấy ngay danh sách phòng mở cho từng server tìm thấy.
  const withRooms = await Promise.all(
    verified.map(async s => {
      const rooms = await fetchLanRooms(s.host, s.port, s.txt);
      return { ...s, rooms };
    }),
  );
  return withRooms;
}

/** Làm tươi danh sách phòng của các server đã quét (poll khi đứng ở màn login). */
export async function refreshRooms(servers: DiscoveredServer[]): Promise<DiscoveredServer[]> {
  if (!servers.length) return servers;
  const updated = await Promise.all(
    servers.map(async s => {
      const rooms = await fetchLanRooms(s.host, s.port, s.txt, 2500);
      return rooms ? { ...s, rooms } : s;
    }),
  );
  return updated;
}
