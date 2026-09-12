import { SamuraiEvent, SamuraiEventPayload } from './api.service';

/* ------------------------------------------------------------------ *
 * Recon result shapes (persisted as ``web_recon_results`` findings and
 * streamed in ``analysis_completed.payload.results``).
 * ------------------------------------------------------------------ */

export interface ReconApiEndpoint {
  path: string;
  status: number;
  content_type: string;
}

export interface ReconResults {
  dns?: Record<string, string[]>;
  subdomains?: {
    total_found: number;
    active: Record<string, string[]>;
    discovered_count: number;
    active_count?: number;
    discovered_hosts?: string[];
  };
  apis?: {
    apis_found: ReconApiEndpoint[];
    documentation: string[];
    framework: string | null;
    headers_analysis: Record<string, string>;
    graphql_enabled: boolean;
    base_url?: string;
    probed_paths?: number;
  };
  headers?: {
    present: Record<string, { value: string; description: string }>;
    missing: string[];
    risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
    recommendations: string[];
  };
  technology?: {
    frontend: string[];
    backend: string[];
    cdn: string | null;
    interesting_findings: string[];
  };
}

export interface OpenPortDetail {
  token: string;
  service: string;
  version: string;
}

/* ------------------------------------------------------------------ *
 * Pure xwa-sdk ``Event`` helpers. Kept dependency-free so the parsing
 * contract is unit-testable without Angular or a live WebSocket.
 * ------------------------------------------------------------------ */

/** Parse a raw WebSocket frame into an ``Event`` envelope, or ``null``. */
export function parseEventEnvelope(raw: unknown): SamuraiEvent | null {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<SamuraiEvent>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.seq === 'number' &&
      typeof parsed.type === 'string'
    ) {
      return parsed as SamuraiEvent;
    }
  } catch {
    return null;
  }

  return null;
}

function payloadOf(event: SamuraiEvent): SamuraiEventPayload {
  return event.payload ?? {};
}

/** ``item_found`` payload for an nmap open port. */
export function openPortFromEvent(event: SamuraiEvent): OpenPortDetail | null {
  if (event.type !== 'item_found') return null;
  const payload = payloadOf(event);
  if (payload.kind !== 'open_port') return null;

  const port = String(payload.port ?? '').trim();
  if (!port) return null;

  const protocol = String(payload.protocol ?? 'tcp').toLowerCase();
  return {
    token: `${port}/${protocol}`,
    service: String(payload.service ?? 'unknown'),
    version: String(payload.version ?? 'n/a') || 'n/a'
  };
}

/** ``analysis_progress`` payload carrying per-URL contact counters. */
export function contactProgressFromEvent(
  event: SamuraiEvent
): { url: string; emails: number; phones: number; total: number } | null {
  if (event.type !== 'analysis_progress') return null;
  const data = event.payload?.data;
  if (!data?.url) return null;

  const emails = Number(data.emails_count ?? data.emails?.length ?? 0);
  const phones = Number(data.phones_count ?? data.phones?.length ?? 0);
  return { url: String(data.url), emails, phones, total: emails + phones };
}

/** ``item_found`` payloads for unsanitized / reflected form inputs. */
export function unsanitizedFromEvent(
  event: SamuraiEvent
): { url: string; forms: number; reflected: boolean } | null {
  if (event.type !== 'item_found') return null;
  const payload = payloadOf(event);

  if (payload.kind === 'unsanitized_input') {
    return { url: String(payload.url ?? ''), forms: Number(payload.forms ?? 0), reflected: false };
  }
  if (payload.kind === 'reflected_input') {
    return { url: String(payload.url ?? ''), forms: 0, reflected: true };
  }

  return null;
}

/** Human-readable terminal line for a DAST ``item_found`` event. */
export function findingLineFromEvent(event: SamuraiEvent): string | null {
  if (event.type !== 'item_found') return null;
  const payload = payloadOf(event);
  const label = payload.title ?? payload['finding_type'];
  if (typeof label !== 'string' || !label) return null;

  const description = payload.description ? `: ${String(payload.description)}` : '';
  return `    [!] ${label}${description}`;
}

/** Terminal line for a generic lifecycle event (vuln terminal). */
export function terminalLineFromEvent(event: SamuraiEvent): string | null {
  switch (event.type) {
    case 'log':
      return String(payloadOf(event).line ?? '');
    case 'analysis_started':
      return `[i] Analysis #${event.analysis_id} started (${event.tool})`;
    case 'analysis_progress': {
      const payload = payloadOf(event);
      if (!payload.message) return null;
      return payload.phase ? `[${payload.phase}] ${payload.message}` : String(payload.message);
    }
    case 'item_found':
      return findingLineFromEvent(event);
    case 'analysis_completed':
      return '[done] analysis completed';
    case 'analysis_error':
      return `[!] ${payloadOf(event).error?.message || 'Analysis error'}`;
    default:
      return null;
  }
}

/** Extract recon results from ``analysis_completed.payload.results``. */
export function reconResultsFromEvent(event: SamuraiEvent): ReconResults | null {
  if (event.type !== 'analysis_completed') return null;
  const results = payloadOf(event).results;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return null;
  return results as ReconResults;
}

/** Legacy plain-text ``80/tcp open http`` log line. */
export function openPortTokenFromLogLine(line: string): string | null {
  const match = line.match(/^(\d+)\/(tcp|udp)\s+open\b/i);
  return match ? `${match[1]}/${match[2].toLowerCase()}` : null;
}

/** Detailed port line: ``[OPEN_PORT] 80/tcp http nginx`` or the summary row. */
export function openPortDetailFromLogLine(line: string): OpenPortDetail | null {
  const detailed = line.match(/^\[OPEN_PORT\]\s+(\d+)\/(tcp|udp)\s+(\S+)\s+(.+)$/i);
  if (detailed) {
    return {
      token: `${detailed[1]}/${detailed[2].toLowerCase()}`,
      service: detailed[3].trim(),
      version: detailed[4].trim()
    };
  }

  const summary = line.match(/^\s+-\s+(\d+)\/(tcp|udp)\s+\|\s+(.+?)\s+\|\s+(.+)$/i);
  if (summary) {
    return {
      token: `${summary[1]}/${summary[2].toLowerCase()}`,
      service: summary[3].trim(),
      version: summary[4].trim()
    };
  }

  return null;
}

/** Legacy ``[SCAN_META] scan_id=42`` log line. */
export function scanIdFromLogLine(line: string): number | null {
  const match = line.match(/^\[SCAN_META\]\s*scan_id=(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** Parse a persisted ``OPEN_PORT`` finding payload (``port=80 protocol=tcp ...``). */
export function openPortFromPayload(payload: string | null | undefined): OpenPortDetail {
  if (!payload) return { token: 'n/a', service: 'n/a', version: 'n/a' };

  const portMatch = payload.match(/port=(\d+)/i);
  const protoMatch = payload.match(/protocol=(tcp|udp)/i);

  return {
    token: portMatch && protoMatch ? `${portMatch[1]}/${protoMatch[1].toLowerCase()}` : 'n/a',
    service: payload.match(/service=([^\n]+)/i)?.[1]?.trim() || 'n/a',
    version: payload.match(/version=([^\n]+)/i)?.[1]?.trim() || 'n/a'
  };
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

/** Severity → Nothing status color mapping (value-level color only). */
export function severityTone(severity: string): StatusTone {
  switch (String(severity).toLowerCase()) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'success';
    default:
      return 'neutral';
  }
}
