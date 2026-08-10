export type IntegrationRecord = { sourceId: string; payload: Record<string, unknown>; receivedAt: string };
export type IntegrationSyncResult = { cursor?: string; records: IntegrationRecord[]; warnings: string[] };

export interface PayrollIntegrationConnector {
  readonly type: string;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  sync(cursor?: string): Promise<IntegrationSyncResult>;
}

export class MockPayrollConnector implements PayrollIntegrationConnector {
  readonly type = 'MOCK';
  constructor(private readonly records: IntegrationRecord[]) {}
  async testConnection() { return { ok: true, message: 'Mock connector ready.' }; }
  async sync() { return { records: this.records, warnings: [] }; }
}
