/**
 * Plugin Interface — All plugins implement this contract
 */

export type PluginType = 'scanner' | 'tester' | 'provider' | 'notification' | 'intake' | 'generator';

export interface PluginResult {
  success: boolean;
  errors: PluginError[];
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface PluginError {
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ScannerPlugin {
  readonly name: string;
  readonly type: 'scanner';

  /** Check if the scanner tool is available */
  isAvailable(): Promise<boolean>;

  /** Run the scanner on the given directory */
  scan(workingDir: string): Promise<PluginResult>;
}

export interface TesterPlugin {
  readonly name: string;
  readonly type: 'tester';

  isAvailable(): Promise<boolean>;

  /** Run tests and return results */
  run(workingDir: string): Promise<PluginResult & {
    passed: number;
    failed: number;
    skipped: number;
    coverage?: number;
  }>;
}
