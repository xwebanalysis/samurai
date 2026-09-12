import type { ReconResults } from '../../../core/live-events';

/** Recon result tree lives in core (parsed from xwa-sdk Event envelopes). */
export type { ReconResults } from '../../../core/live-events';

export type ReconModuleId = 'dns' | 'subdomains' | 'apis' | 'headers' | 'tech' | 'all';

export interface ReconModule {
  id: ReconModuleId;
  label: string;
  icon: string;
  description: string;
}

export type ReconResultsViewId =
  | 'all'
  | 'surface-map'
  | 'dns'
  | 'subdomains'
  | 'apis'
  | 'auth-session'
  | 'headers'
  | 'client-side'
  | 'tech';

export interface ReconResultsViewOption {
  id: ReconResultsViewId;
  label: string;
}

export type ReconResultsTree = ReconResults;
