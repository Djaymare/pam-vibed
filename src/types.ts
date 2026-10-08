export interface WindowsApplication {
  appId: string;
  kind: 'desktop' | 'store';
  icon: string | null;
  launchArgument?: string;
}
export interface InstalledApplication extends WindowsApplication {
  name: string;
}
export interface Application {
  id: string;
  name: string;
  description: string;
  executable: string;
  arguments: string[];
  aliases: string[];
  enabled: boolean;
  windowsApp?: WindowsApplication;
}
export interface Config {
  version: number;
  applications: Application[];
  language: string;
  autoExecute: boolean;
  confidenceThreshold: number;
}
export interface RuntimeStatus {
  ready: boolean;
  checks: { file: string; available: boolean }[];
  manifest: { node: string; npm: string; target: string } | null;
  config: Config;
  configDirectory: string;
  engine: { loaded: boolean; generation: number; pid: number } | null;
  desktop?: { shortcut: string; shortcutAvailable: boolean; shortcutError: string; closeToTray: boolean };
}
export interface Turn {
  id: string;
  transcript: string;
  language: string;
  confidence: number | null;
  reasoning: string;
  durationMs: number;
  calls: { name: string; arguments: Record<string, string>; applicationId: string; applicationName: string }[];
  correctedFrom?: string;
  results: { applicationName: string; success: boolean; message: string }[];
  status: 'executed' | 'pending' | 'unsupported' | 'silence' | 'failed' | 'cancelled';
}
