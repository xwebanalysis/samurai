import type {
  DiscoveredLink as CoreDiscoveredLink,
  Finding as CoreFinding,
  ScanDetail as CoreScanDetail,
  ScanListItem as CoreScanListItem
} from '../../../core/api.service';

// Canonical REST shapes live in core/api.service; the feature re-exports them
// so scan-detail input bindings match the ApiService observables exactly.
export type Finding = CoreFinding;
export type DiscoveredLink = CoreDiscoveredLink;
export type ScanDetail = CoreScanDetail;
export type ScanListItem = CoreScanListItem;

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface TrendSnapshot {
  id: number;
  riskScore: number;
  totalFindings: number;
  label: string;
}

export interface AnalysisSummary {
  totalLinks: number;
  vulnerableLinks: number;
  cleanLinks: number;
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  coveragePct: number;
  riskScore: number;
  avgFindingsPerLink: string;
  terminalEvents: number;
}
