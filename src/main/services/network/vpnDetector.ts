import * as os from 'os';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { exec } from 'child_process';
import { VPNStatus, VPNVerificationDetail, GeoLocation } from './networkTypes';
import { GeoIPService } from './geoip';

const isMac = process.platform === 'darwin';

const VPN_ADAPTER_PATTERNS = [
  /tun/i, /tap/i, /wintun/i, /openvpn/i, /wireguard/i, /wg/i,
  /vpn/i, /ppp/i, /l2tp/i, /sstp/i, /ikev/i, /ipsec/i,
  /nordvpn/i, /expressvpn/i, /protonvpn/i, /mullvad/i, /surfshark/i,
  /cyberghost/i, /pia/i, /vyprvpn/i, /tunnelbear/i, /nord/i,
  /utun/i, /gpd/i, /hamachi/i, /zerotier/i, /tailscale/i,
];

const KNOWN_VPN_PROVIDERS = [
  'nordvpn', 'expressvpn', 'protonvpn', 'mullvad', 'surfshark',
  'cyberghost', 'private internet access', 'pia', 'vyprvpn',
  'tunnelbear', 'ipvanish', 'windscribe', 'hotspot shield',
  'nord security', 'tesonet', 'm247', 'datacamp limited',
  'leaseweb', 'choopa', 'm247 europe', 'gthost',
];

export class VPNDetector {
  private geoIP: GeoIPService;

  constructor(geoIP: GeoIPService) {
    this.geoIP = geoIP;
  }

  async detect(): Promise<VPNStatus> {
    const details: VPNVerificationDetail[] = [];

    // 1. Check network interfaces for VPN adapters
    const interfaces = os.networkInterfaces();
    let vpnAdapterName: string | null = null;
    let vpnAdapterType: string | null = null;
    const encryptedInterfaces: string[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const pattern of VPN_ADAPTER_PATTERNS) {
        if (pattern.test(name)) {
          vpnAdapterName = name;
          vpnAdapterType = this.guessAdapterType(name);
          encryptedInterfaces.push(name);
          break;
        }
      }
    }

    details.push({
      check: 'VPN Adapter Detection',
      status: vpnAdapterName ? 'pass' : 'fail',
      message: vpnAdapterName
        ? `Found VPN adapter: ${vpnAdapterName} (${vpnAdapterType})`
        : 'No VPN adapter detected in network interfaces',
    });

    // 2. Get public IP
    const publicIP = await this.getPublicIP();
    let publicIPGeo: GeoLocation | undefined;

    if (publicIP) {
      publicIPGeo = (await this.geoIP.lookup(publicIP)) || undefined;

      if (publicIPGeo) {
        // 3. Check if ISP is a known VPN provider
        const ispLower = (publicIPGeo.isp + ' ' + publicIPGeo.org).toLowerCase();
        const matchedProvider = KNOWN_VPN_PROVIDERS.find((p) => ispLower.includes(p));

        details.push({
          check: 'VPN ISP Verification',
          status: matchedProvider ? 'pass' : 'warning',
          message: matchedProvider
            ? `Public IP ISP matches known VPN provider: ${matchedProvider}`
            : `Public IP ISP: ${publicIPGeo.isp} - not a recognized VPN provider`,
        });

        details.push({
          check: 'Exit Server Location',
          status: 'pass',
          message: `Traffic exits via ${publicIPGeo.city}, ${publicIPGeo.country} (${publicIP})`,
        });
      }
    } else {
      details.push({
        check: 'Public IP Detection',
        status: 'fail',
        message: 'Could not determine public IP address',
      });
    }

    // 4. Get DNS servers
    const dnsServers = await this.getDNSServers();
    details.push({
      check: 'DNS Configuration',
      status: dnsServers.length > 0 ? 'pass' : 'warning',
      message: dnsServers.length > 0
        ? `DNS servers: ${dnsServers.join(', ')}`
        : 'Could not determine DNS servers',
    });

    // 5. DNS Leak Test - only meaningful when VPN is active
    let dnsLeakDetected = false;
    const anycastDNS = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '208.67.222.222', '208.67.220.220'];

    if (vpnAdapterName && publicIPGeo && dnsServers.length > 0) {
      // Filter out anycast DNS servers - GeoIP is unreliable for them
      const testableDNS = dnsServers.filter((ip) => !anycastDNS.includes(ip));

      if (testableDNS.length === 0) {
        details.push({
          check: 'DNS Leak Test',
          status: 'warning',
          message: `All DNS servers are anycast (e.g. Google/Cloudflare). Cannot reliably test for leaks. DNS: ${dnsServers.join(', ')}`,
        });
      } else {
        const dnsGeos = await Promise.all(
          testableDNS.slice(0, 3).map((ip) => this.geoIP.lookup(ip))
        );

        const dnsCountries = dnsGeos
          .filter((g): g is GeoLocation => g !== null)
          .map((g) => g.country);

        const vpnCountry = publicIPGeo.country;
        const mismatchedDNS = dnsCountries.filter((c) => c && c !== vpnCountry);

        dnsLeakDetected = mismatchedDNS.length > 0;

        details.push({
          check: 'DNS Leak Test',
          status: dnsLeakDetected ? 'fail' : 'pass',
          message: dnsLeakDetected
            ? `DNS leak detected! DNS servers resolve from: ${mismatchedDNS.join(', ')} (expected: ${vpnCountry})`
            : `DNS servers resolve from ${vpnCountry} - no leak detected`,
        });
      }
    } else if (!vpnAdapterName) {
      details.push({
        check: 'DNS Leak Test',
        status: 'pass',
        message: 'No VPN active - DNS leak test not applicable',
      });
    } else {
      details.push({
        check: 'DNS Leak Test',
        status: 'unknown',
        message: 'Could not perform DNS leak test - missing location data',
      });
    }

    // 6. Kill switch check (basic - check if default route goes through VPN)
    const killSwitchActive = await this.checkKillSwitch(vpnAdapterName);
    details.push({
      check: 'Kill Switch',
      status: killSwitchActive ? 'pass' : 'unknown',
      message: killSwitchActive
        ? 'Kill switch appears active - default route goes through VPN'
        : 'Could not verify kill switch status',
    });

    // 7. WebRTC leak (will be checked in renderer)
    details.push({
      check: 'WebRTC Leak Test',
      status: 'unknown',
      message: 'WebRTC test requires browser context - check renderer',
    });

    const isActive = vpnAdapterName !== null && publicIP !== '';

    return {
      isActive,
      adapterName: vpnAdapterName,
      adapterType: vpnAdapterType,
      publicIP: publicIP || '',
      publicIPGeo,
      vpnProvider: this.detectProvider(vpnAdapterName, publicIPGeo),
      dnsServers,
      dnsLeakDetected,
      webrtcLeakDetected: false,
      killSwitchActive,
      encryptedInterfaces,
      verificationDetails: details,
    };
  }

  private guessAdapterType(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('nordlynx')) return 'NordVPN (WireGuard) - Authenticated';
    if (lower.includes('wireguard') || lower.includes('wg')) return 'WireGuard';
    if (lower.includes('openvpn') || lower.includes('tun')) return 'OpenVPN (TUN)';
    if (lower.includes('tap')) return 'OpenVPN (TAP)';
    if (lower.includes('wintun')) return 'WinTun';
    if (lower.includes('ikev') || lower.includes('ipsec')) return 'IKEv2/IPSec';
    if (lower.includes('l2tp')) return 'L2TP';
    if (lower.includes('sstp')) return 'SSTP';
    if (lower.includes('ppp')) return 'PPP';
    if (lower.includes('tailscale')) return 'Tailscale';
    if (lower.includes('zerotier')) return 'ZeroTier';
    return 'Unknown VPN';
  }

  private detectProvider(adapterName: string | null, geo?: GeoLocation): string | null {
    if (adapterName) {
      const lower = adapterName.toLowerCase();
      if (lower.includes('nord')) return 'NordVPN';
      if (lower.includes('express')) return 'ExpressVPN';
      if (lower.includes('proton')) return 'ProtonVPN';
      if (lower.includes('mullvad')) return 'Mullvad';
      if (lower.includes('surfshark')) return 'Surfshark';
      if (lower.includes('cyberghost')) return 'CyberGhost';
      if (lower.includes('tailscale')) return 'Tailscale';
      if (lower.includes('zerotier')) return 'ZeroTier';
    }
    if (geo) {
      const ispLower = (geo.isp + ' ' + geo.org).toLowerCase();
      for (const provider of KNOWN_VPN_PROVIDERS) {
        if (ispLower.includes(provider)) {
          return provider.charAt(0).toUpperCase() + provider.slice(1);
        }
      }
    }
    return null;
  }

  private getPublicIP(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.get('https://api.ipify.org?format=json', { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.ip || null);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  private getDNSServers(): Promise<string[]> {
    if (isMac) {
      return this.getDNSServersMac();
    }
    return new Promise((resolve) => {
      const script = "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses | Sort-Object -Unique";
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { timeout: 5000, windowsHide: true },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            const servers = dns.getServers();
            resolve(servers);
            return;
          }
          const servers = stdout
            .trim()
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('fec') && !s.startsWith('fd'));
          resolve(servers);
        }
      );
    });
  }

  private getDNSServersMac(): Promise<string[]> {
    return new Promise((resolve) => {
      exec(
        'scutil --dns 2>/dev/null | grep "nameserver" | sort -u',
        { timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(dns.getServers());
            return;
          }
          const servers = stdout
            .trim()
            .split('\n')
            .map((s) => s.replace(/nameserver\[\d*\]\s*[:=]?\s*/, '').trim())
            .filter((s) => s && !s.startsWith('fec') && !s.startsWith('fd'));
          resolve(servers.length > 0 ? servers : dns.getServers());
        }
      );
    });
  }

  private async checkKillSwitch(vpnAdapter: string | null): Promise<boolean> {
    if (!vpnAdapter) return false;

    if (isMac) {
      return this.checkKillSwitchMac(vpnAdapter);
    }

    return new Promise((resolve) => {
      const script = "Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -ExpandProperty InterfaceAlias";
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { timeout: 5000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }
          const routes = stdout.trim().split('\n').map((s) => s.trim());
          resolve(routes.some((r) => r.toLowerCase().includes(vpnAdapter.toLowerCase())));
        }
      );
    });
  }

  private checkKillSwitchMac(vpnAdapter: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(
        'netstat -rn 2>/dev/null | grep default',
        { timeout: 5000 },
        (error, stdout) => {
          if (error) { resolve(false); return; }
          const routes = stdout.trim().split('\n');
          resolve(routes.some((r) => r.toLowerCase().includes(vpnAdapter.toLowerCase())));
        }
      );
    });
  }
}
