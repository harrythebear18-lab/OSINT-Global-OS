import { GeoLocation } from './networkTypes';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { app } from 'electron';

export class GeoIPService {
  private cache = new Map<string, GeoLocation>();
  private pending = new Set<string>();
  private readonly cacheDir: string;
  private pendingCount = 0;
  private onPendingChange?: (count: number) => void;

  constructor() {
    this.cacheDir = app
      ? path.join(app.getPath('userData'), 'geoip-cache.json')
      : '';
    this.loadCache();
  }

  setOnPendingChange(callback: (count: number) => void) {
    this.onPendingChange = callback;
  }

  getPendingCount() {
    return this.pendingCount;
  }

  private loadCache() {
    try {
      if (this.cacheDir && fs.existsSync(this.cacheDir)) {
        const data = JSON.parse(fs.readFileSync(this.cacheDir, 'utf8'));
        for (const [ip, geo] of Object.entries(data)) {
          this.cache.set(ip, geo as GeoLocation);
        }
      }
    } catch (e) {
      // ignore cache load errors
    }
  }

  private saveCache() {
    try {
      if (this.cacheDir) {
        const obj: Record<string, GeoLocation> = {};
        for (const [ip, geo] of this.cache.entries()) {
          obj[ip] = geo;
        }
        fs.writeFileSync(this.cacheDir, JSON.stringify(obj));
      }
    } catch (e) {
      // ignore cache save errors
    }
  }

  async lookup(ip: string): Promise<GeoLocation | null> {
    if (this.isPrivateIP(ip)) return null;
    if (this.cache.has(ip)) return this.cache.get(ip)!;
    const results = await this.lookupBatch([ip]);
    return results.get(ip) || null;
  }

  async lookupBatch(ips: string[]): Promise<Map<string, GeoLocation | null>> {
    const results = new Map<string, GeoLocation | null>();
    const uniqueIPs = [...new Set(ips.filter((ip) => !this.isPrivateIP(ip) && !this.cache.has(ip) && !this.pending.has(ip)))];

    // Return cached results immediately
    for (const ip of ips) {
      if (this.isPrivateIP(ip)) {
        results.set(ip, null);
      } else if (this.cache.has(ip)) {
        results.set(ip, this.cache.get(ip)!);
      }
    }

    if (uniqueIPs.length === 0) return results;

    // Mark as pending
    for (const ip of uniqueIPs) {
      this.pending.add(ip);
    }
    this.pendingCount = this.pending.size;
    this.onPendingChange?.(this.pendingCount);

    // Process in chunks of 100 (batch API limit)
    for (let i = 0; i < uniqueIPs.length; i += 100) {
      const chunk = uniqueIPs.slice(i, i + 100);
      try {
        const chunkResults = await this.batchLookupChunk(chunk);
        for (const [ip, geo] of chunkResults.entries()) {
          results.set(ip, geo);
          this.pending.delete(ip);
          if (geo) {
            this.cache.set(ip, geo);
          }
        }
      } catch (e) {
        for (const ip of chunk) {
          this.pending.delete(ip);
        }
      }
    }

    this.pendingCount = this.pending.size;
    this.onPendingChange?.(this.pendingCount);
    this.saveCache();
    return results;
  }

  private async batchLookupChunk(ips: string[]): Promise<Map<string, GeoLocation | null>> {
    const results = new Map<string, GeoLocation | null>();
    const postData = JSON.stringify(
      ips.map((ip) => ({
        query: ip,
        fields: 'status,message,country,countryCode,region,city,lat,lon,timezone,isp,org,as,query',
      }))
    );

    const result = await new Promise<any[]>((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'ip-api.com',
          path: '/batch',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: any) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
      req.write(postData);
      req.end();
    });

    for (const item of result) {
      const ip = item.query || '';
      if (item.status === 'success') {
        results.set(ip, {
          ip,
          country: item.country || 'Unknown',
          countryCode: item.countryCode || '',
          city: item.city || 'Unknown',
          region: item.region || '',
          lat: item.lat || 0,
          lon: item.lon || 0,
          isp: item.isp || 'Unknown',
          org: item.org || '',
          as: item.as || '',
          timezone: item.timezone || '',
        });
      } else {
        results.set(ip, null);
      }
    }
    return results;
  }

  private isPrivateIP(ip: string): boolean {
    if (!ip || typeof ip !== 'string') return true;
    if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('169.254.')) return true;
    if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true;
    if (ip.startsWith('fe80:')) return true;
    if (ip.startsWith('fc')) return true;
    if (ip.startsWith('fd')) return true;
    if (ip.includes(':') && !ip.includes('.')) {
      // IPv6 - skip link-local and unique local
      return true;
    }
    return false;
  }

  clearCache() {
    this.cache.clear();
    this.saveCache();
  }
}
