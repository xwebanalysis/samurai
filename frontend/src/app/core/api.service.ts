import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/** xwa-sdk ``Event`` envelope emitted by every samurai WebSocket endpoint. */
export interface SamuraiEvent {
  seq: number;
  type:
    | 'analysis_started'
    | 'analysis_progress'
    | 'item_found'
    | 'analysis_completed'
    | 'analysis_error'
    | 'log'
    | string;
  tool: string;
  analysis_id: string;
  ts: string;
  payload?: SamuraiEventPayload;
}

export interface SamuraiEventPayload {
  line?: string;
  phase?: string;
  message?: string;
  title?: string;
  description?: string;
  kind?: string;
  url?: string;
  target?: string;
  status?: string;
  scan_id?: number;
  port?: string | number;
  protocol?: string;
  service?: string;
  version?: string;
  forms?: number;
  probe_url?: string;
  probe?: string;
  items?: unknown[];
  data?: {
    url?: string;
    emails?: string[];
    phones?: string[];
    emails_count?: number;
    phones_count?: number;
    [key: string]: unknown;
  };
  summary?: Record<string, unknown>;
  results?: unknown;
  error?: {
    code: string;
    message: string;
    detail?: unknown;
    retryable?: boolean;
  };
  [key: string]: unknown;
}

export interface Finding {
  id?: number;
  scan_id?: number;
  link_id?: number | null;
  severity: string;
  finding_type: string;
  description: string;
  poc_payload?: string | null;
  cvss_score?: string | null;
}

export interface DiscoveredLink {
  id: number;
  scan_id?: number;
  url: string;
  status_code: number;
  content_type: string;
  findings: Finding[];
}

export interface ScanListItem {
  id: number;
  scan_type?: string;
  created_at?: string;
  domain_target?: string;
  status?: string;
  findings?: Finding[];
  discovered_links?: DiscoveredLink[];
}

export interface ScanDetail {
  id: number;
  domain_target: string;
  status: string;
  scan_type: string;
  created_at?: string;
  findings?: Finding[];
  discovered_links: DiscoveredLink[];
}

export interface HealthResponse {
  status: string;
  database: string;
  version: string;
  tool: string;
}

export interface DatabaseExportRawResponse {
  export_metadata?: {
    scan_count?: number;
    finding_count?: number;
    link_count?: number;
  };
  [key: string]: unknown;
}

export type ExportFormat = 'json' | 'csv';

export interface ScannerLiveParams {
  target: string;
  profile: string;
  timeout: number;
  webScan: boolean;
  collectContacts: boolean;
  scanUnsanitized: boolean;
  maxPages: number;
}

export interface VulnLiveParams {
  target: string;
  modules: string;
  authMode: string;
  bearerToken?: string;
  basicUser?: string;
  basicPass?: string;
  cookieHeader?: string;
}

export interface ReconLiveParams {
  target: string;
  modules: string[];
  timeout?: number;
}

/**
 * Central REST gateway. Every HTTP call in the application goes through this
 * service; components never build API URLs or inject ``HttpClient`` directly.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiBaseUrl;
  private readonly wsUrl = environment.wsBaseUrl;

  health(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${this.apiUrl}/api/health`);
  }

  listScans(): Observable<ScanListItem[]> {
    return this.http.get<ScanListItem[]>(`${this.apiUrl}/api/scans`);
  }

  getScan(id: number): Observable<ScanDetail> {
    return this.http.get<ScanDetail>(`${this.apiUrl}/api/scans/${id}`);
  }

  deleteScan(id: number): Observable<{ status: string; scan_id: number }> {
    return this.http.delete<{ status: string; scan_id: number }>(`${this.apiUrl}/api/scans/${id}`);
  }

  cancelScan(id: number): Observable<{ status: string; scan_id: number }> {
    return this.http.post<{ status: string; scan_id: number }>(
      `${this.apiUrl}/api/scan/cancel/${id}`,
      {}
    );
  }

  exportDatabaseRaw(): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.apiUrl}/api/database/export/raw`, {
      responseType: 'blob',
      observe: 'response'
    });
  }

  exportDatabaseEncrypted(password: string): Observable<HttpResponse<Blob>> {
    return this.http.post(
      `${this.apiUrl}/api/database/export/encrypted`,
      { password },
      { responseType: 'blob', observe: 'response' }
    );
  }

  /** Server-side analysis export URL (Content-Disposition attachment). */
  analysisExportUrl(id: number | string, format: ExportFormat = 'json'): string {
    return `${this.apiUrl}/api/analyses/${id}/export?format=${format}`;
  }

  /** Live nmap + web-surface stream. */
  scannerLiveUrl(params: ScannerLiveParams): string {
    const query = new URLSearchParams({
      target: params.target,
      profile: params.profile,
      timeout: String(params.timeout),
      web_scan: String(params.webScan),
      collect_contacts: String(params.collectContacts),
      scan_unsanitized: String(params.scanUnsanitized),
      max_pages: String(params.maxPages)
    });
    return `${this.wsUrl}/api/scan/live?${query.toString()}`;
  }

  /** Live DAST crawler stream. */
  vulnLiveUrl(params: VulnLiveParams): string {
    const query = new URLSearchParams({
      target: params.target,
      modules: params.modules,
      auth_mode: params.authMode
    });

    if (params.bearerToken?.trim()) {
      query.set('auth_bearer', params.bearerToken.trim());
    }
    if (params.basicUser?.trim()) {
      query.set('auth_user', params.basicUser.trim());
    }
    if (params.basicPass) {
      query.set('auth_pass', params.basicPass);
    }
    if (params.cookieHeader?.trim()) {
      query.set('auth_cookie', params.cookieHeader.trim());
    }

    return `${this.wsUrl}/api/vuln/live?${query.toString()}`;
  }

  /** Live recon stream (direct backend). */
  reconLiveUrl(params: ReconLiveParams): string {
    const query = new URLSearchParams({
      target: params.target,
      recon_types: params.modules.join(','),
      timeout: String(params.timeout ?? 300)
    });
    return `${this.wsUrl}/api/recon/live?${query.toString()}`;
  }

  /**
   * Recon URLs in fallback order: direct backend first, same-origin proxy
   * second (Nginx may expose ``/api`` in production).
   */
  reconLiveUrls(params: ReconLiveParams): string[] {
    const direct = this.reconLiveUrl(params);
    const query = new URLSearchParams({
      target: params.target,
      recon_types: params.modules.join(','),
      timeout: String(params.timeout ?? 300)
    });
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const proxy = `${wsProtocol}//${window.location.host}/api/recon/live?${query.toString()}`;
    return Array.from(new Set([direct, proxy]));
  }
}
