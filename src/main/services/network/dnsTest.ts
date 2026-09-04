import { exec } from 'child_process';
import { DNSTestResult } from './networkTypes';

export class DNSTestService {
  private readonly defaultServers = [
    { name: 'Google DNS', ip: '8.8.8.8' },
    { name: 'Cloudflare DNS', ip: '1.1.1.1' },
    { name: 'OpenDNS', ip: '208.67.222.222' },
    { name: 'Quad9', ip: '9.9.9.9' },
    { name: 'Comodo DNS', ip: '8.26.56.26' },
  ];

  async testDNSServer(server: string, ip: string): Promise<DNSTestResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      exec(
        `nslookup google.com ${ip}`,
        { windowsHide: true, timeout: 5000 },
        (error) => {
          const latency = Date.now() - startTime;
          resolve({
            server,
            ip,
            latency,
            success: !error,
            timestamp: Date.now(),
          });
        }
      );
    });
  }

  async testAllServers(servers?: Array<{ name: string; ip: string }>): Promise<DNSTestResult[]> {
    const serversToTest = servers || this.defaultServers;
    const results: DNSTestResult[] = [];

    // Test servers in parallel
    const promises = serversToTest.map(server => 
      this.testDNSServer(server.name, server.ip)
    );

    const settledResults = await Promise.allSettled(promises);
    
    for (const result of settledResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    // Sort by latency (fastest first)
    return results.sort((a, b) => a.latency - b.latency);
  }

  async testCustomServers(servers: string[]): Promise<DNSTestResult[]> {
    const serverObjects = servers.map((ip, index) => ({
      name: `Custom DNS ${index + 1}`,
      ip,
    }));
    return this.testAllServers(serverObjects);
  }

  getDefaultServers(): Array<{ name: string; ip: string }> {
    return [...this.defaultServers];
  }
}
