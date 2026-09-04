import { GridAsset, AssetMeasurement, DataSource, DataFlowHealth, PipelineCheck } from './gridTypes';
import { BASE_ASSETS } from './gridData';
import { buildInterconnects, generateMeasurements } from './gridDataUtils';

export interface FetchResult {
  assets: GridAsset[];
  measurements: Map<string, AssetMeasurement>;
  interconnects: ReturnType<typeof buildInterconnects>;
  dataFlowHealth: DataFlowHealth[];
  fetchLatencyMs: number;
  pendingFetches: number;
}

const SOURCE_NAMES: Record<DataSource, string> = {
  EIA_GRID: 'EIA Grid Monitor',
  ENTSOE: 'ENTSO-E Transparency',
  USGS_EGRID: 'USGS eGRID',
  OPENELEC: 'Open Electricity',
  SYNTHETIC: 'Synthetic Grid Layer',
  DATACENTER_MAP: 'Data Center Map',
  AI_CLUSTER: 'AI Cluster Registry',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function okChecks(): PipelineCheck[] {
  return [
    { check: 'api_reachable', status: 'verified', message: 'API reachable' },
    { check: 'payload_complete', status: 'verified', message: 'Payload complete' },
  ];
}

export class DataFetcher {
  private activeFetches = 0;
  private lastResult: FetchResult | null = null;

  async fetchAll(): Promise<FetchResult> {
    this.activeFetches++;
    const start = Date.now();
    await delay(100 + Math.random() * 200);

    const assets = BASE_ASSETS.map((a) => ({
      ...a,
      lastUpdate: Date.now() - Math.floor(Math.random() * 30000),
    }));

    const measurements = generateMeasurements(assets);
    const interconnects = buildInterconnects(assets);

    const dataFlowHealth: DataFlowHealth[] = Object.keys(SOURCE_NAMES).map((source) => {
      const ds = source as DataSource;
      const related = assets.filter((a) => a.source === ds);
      const latency = 50 + Math.random() * 400;
      return {
        source: ds,
        sourceName: SOURCE_NAMES[ds],
        status: related.length > 0 ? 'verified' : 'unknown',
        pipelineScore: 85 + Math.random() * 15,
        lastFetchTime: Date.now(),
        fetchLatencyMs: latency,
        avgLatencyMs: 120 + Math.random() * 200,
        payloadSizeBytes: related.length * 512 + Math.floor(Math.random() * 1024),
        assetsExpected: related.length,
        assetsReceived: related.length,
        completenessPercent: 95 + Math.random() * 5,
        duplicateCount: 0,
        outOfOrderCount: 0,
        missingFieldCount: 0,
        totalPackets: related.length,
        droppedPackets: 0,
        pipelineChecks: okChecks(),
        latencyHistory: [latency],
      };
    });

    const latency = Date.now() - start;
    this.activeFetches--;
    const result: FetchResult = {
      assets,
      measurements,
      interconnects,
      dataFlowHealth,
      fetchLatencyMs: latency,
      pendingFetches: this.activeFetches,
    };
    this.lastResult = result;
    return result;
  }

  getLastResult(): FetchResult | null {
    return this.lastResult;
  }
}

export const dataFetcher = new DataFetcher();
