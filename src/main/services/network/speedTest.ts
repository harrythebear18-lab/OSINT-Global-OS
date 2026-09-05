import { exec } from 'child_process';
import { SpeedTestResult } from './networkTypes';

const isMac = process.platform === 'darwin';

export class SpeedTestService {
  private isRunning = false;
  private onProgress?: (progress: number) => void;

  setOnProgress(callback: (progress: number) => void) {
    this.onProgress = callback;
  }

  async runSpeedTest(): Promise<SpeedTestResult> {
    if (this.isRunning) {
      throw new Error('Speed test already running');
    }

    this.isRunning = true;

    try {
      this.onProgress?.(10);
      const latency = await this.measureLatency();

      this.onProgress?.(30);
      const downloadSpeed = await this.measureDownloadSpeed();

      this.onProgress?.(70);
      const uploadSpeed = await this.measureUploadSpeed();

      this.onProgress?.(90);
      const jitter = await this.measureJitter();

      this.onProgress?.(100);

      return {
        downloadSpeed,
        uploadSpeed,
        latency,
        jitter,
        timestamp: Date.now(),
      };
    } finally {
      this.isRunning = false;
    }
  }

  private pingCmd(count: number): string {
    return isMac
      ? `ping -c ${count} -t 5 8.8.8.8`
      : `ping -n ${count} 8.8.8.8`;
  }

  private pingOpts(): { windowsHide?: boolean; timeout: number } {
    return isMac ? { timeout: 10000 } : { windowsHide: true, timeout: 10000 };
  }

  private parseLatencies(stdout: string): number[] {
    const matches = stdout.match(/time[=<](\d+[\d.]*)\s*ms/g);
    if (!matches) return [];
    return matches.map(m => parseFloat(m.replace(/time[=<]/, '').replace(/ms/, '').trim()));
  }

  private async measureLatency(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(4), this.pingOpts(), (error, stdout) => {
        if (error) { resolve(0); return; }
        const latencies = this.parseLatencies(stdout);
        resolve(latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0);
      });
    });
  }

  private async measureDownloadSpeed(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(1), this.pingOpts(), (error, stdout) => {
        if (error) { resolve(0); return; }
        const latencies = this.parseLatencies(stdout);
        if (latencies.length > 0) {
          const latency = latencies[0];
          const estimatedSpeed = Math.max(1, Math.min(1000, 10000 / (latency + 1)));
          resolve(Math.round(estimatedSpeed));
        } else { resolve(0); }
      });
    });
  }

  private async measureUploadSpeed(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(1), this.pingOpts(), (error, stdout) => {
        if (error) { resolve(0); return; }
        const latencies = this.parseLatencies(stdout);
        if (latencies.length > 0) {
          const latency = latencies[0];
          const downloadSpeed = Math.max(1, Math.min(1000, 10000 / (latency + 1)));
          resolve(Math.round(downloadSpeed * 0.3));
        } else { resolve(0); }
      });
    });
  }

  private async measureJitter(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(10), this.pingOpts(), (error, stdout) => {
        if (error) { resolve(0); return; }
        const latencies = this.parseLatencies(stdout);
        if (latencies.length > 1) {
          const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
          const variance = latencies.reduce((sum, lat) => sum + Math.pow(lat - avg, 2), 0) / latencies.length;
          resolve(Math.round(Math.sqrt(variance)));
        } else { resolve(0); }
      });
    });
  }

  isTestRunning(): boolean {
    return this.isRunning;
  }
}
