import { SamuraiEvent } from './api.service';
import {
  contactProgressFromEvent,
  findingLineFromEvent,
  openPortDetailFromLogLine,
  openPortFromEvent,
  openPortFromPayload,
  openPortTokenFromLogLine,
  parseEventEnvelope,
  reconResultsFromEvent,
  scanIdFromLogLine,
  severityTone,
  terminalLineFromEvent,
  unsanitizedFromEvent
} from './live-events';

function event(partial: Partial<SamuraiEvent>): SamuraiEvent {
  return {
    seq: 1,
    type: 'log',
    tool: 'samurai',
    analysis_id: '42',
    ts: '2026-09-12T10:00:00Z',
    ...partial
  };
}

describe('parseEventEnvelope', () => {
  it('parses valid xwa-sdk Event frames', () => {
    const frame = JSON.stringify(
      event({ type: 'analysis_started', payload: { target: 'example.com' } })
    );
    const parsed = parseEventEnvelope(frame);

    expect(parsed?.type).toBe('analysis_started');
    expect(parsed?.analysis_id).toBe('42');
    expect(parsed?.payload?.['target']).toBe('example.com');
  });

  it('returns null for legacy text and malformed JSON', () => {
    expect(parseEventEnvelope('80/tcp open http')).toBeNull();
    expect(parseEventEnvelope('{not-json')).toBeNull();
    expect(parseEventEnvelope('{"type":"log"}')).toBeNull();
    expect(parseEventEnvelope(null)).toBeNull();
  });
});

describe('scanner event parsing', () => {
  it('extracts open ports from item_found events', () => {
    const port = openPortFromEvent(
      event({
        type: 'item_found',
        payload: { kind: 'open_port', port: '443', protocol: 'TCP', service: 'https', version: 'nginx 1.25' }
      })
    );

    expect(port).toEqual({ token: '443/tcp', service: 'https', version: 'nginx 1.25' });
    expect(openPortFromEvent(event({ type: 'item_found', payload: { kind: 'other' } }))).toBeNull();
    expect(openPortFromEvent(event({ type: 'log' }))).toBeNull();
  });

  it('extracts contact counters from analysis_progress events', () => {
    const contact = contactProgressFromEvent(
      event({
        type: 'analysis_progress',
        payload: {
          phase: 'web_surface',
          message: 'contact intel discovered',
          data: { url: 'http://example.com', emails_count: 2, phones_count: 1 }
        }
      })
    );

    expect(contact).toEqual({ url: 'http://example.com', emails: 2, phones: 1, total: 3 });
    expect(contactProgressFromEvent(event({ type: 'analysis_progress', payload: {} }))).toBeNull();
  });

  it('extracts unsanitized and reflected input findings', () => {
    expect(
      unsanitizedFromEvent(
        event({
          type: 'item_found',
          payload: { kind: 'unsanitized_input', url: 'http://example.com/form', forms: 3 }
        })
      )
    ).toEqual({ url: 'http://example.com/form', forms: 3, reflected: false });

    expect(
      unsanitizedFromEvent(
        event({ type: 'item_found', payload: { kind: 'reflected_input', url: 'http://example.com?q=x' } })
      )
    ).toEqual({ url: 'http://example.com?q=x', forms: 0, reflected: true });
  });

  it('parses legacy plain-text log lines', () => {
    expect(openPortTokenFromLogLine('22/tcp open ssh')).toBe('22/tcp');
    expect(openPortTokenFromLogLine('Starting Nmap 7.95')).toBeNull();

    expect(openPortDetailFromLogLine('[OPEN_PORT] 80/tcp http nginx 1.25')).toEqual({
      token: '80/tcp',
      service: 'http',
      version: 'nginx 1.25'
    });
    expect(openPortDetailFromLogLine('    - 22/tcp | ssh | OpenSSH 9.6')).toEqual({
      token: '22/tcp',
      service: 'ssh',
      version: 'OpenSSH 9.6'
    });

    expect(scanIdFromLogLine('[SCAN_META] scan_id=99')).toBe(99);
    expect(scanIdFromLogLine('no meta here')).toBeNull();
  });

  it('parses persisted OPEN_PORT finding payloads', () => {
    expect(
      openPortFromPayload('port=8080\nprotocol=tcp\nservice=http-proxy\nversion=nginx')
    ).toEqual({ token: '8080/tcp', service: 'http-proxy', version: 'nginx' });
    expect(openPortFromPayload(null)).toEqual({ token: 'n/a', service: 'n/a', version: 'n/a' });
  });
});

describe('DAST event parsing', () => {
  it('formats item_found events as terminal lines', () => {
    expect(
      findingLineFromEvent(
        event({
          type: 'item_found',
          payload: { title: 'SQLI', description: 'Anomaly detected' }
        })
      )
    ).toBe('    [!] SQLI: Anomaly detected');

    expect(findingLineFromEvent(event({ type: 'item_found', payload: {} }))).toBeNull();
  });

  it('formats lifecycle events and ignores unknown ones', () => {
    expect(terminalLineFromEvent(event({ type: 'log', payload: { line: 'hello' } }))).toBe('hello');
    expect(
      terminalLineFromEvent(event({ type: 'analysis_started' }))
    ).toBe('[i] Analysis #42 started (samurai)');
    expect(
      terminalLineFromEvent(
        event({ type: 'analysis_progress', payload: { phase: 'tls', message: 'auditing' } })
      )
    ).toBe('[tls] auditing');
    expect(
      terminalLineFromEvent(event({ type: 'analysis_error', payload: { error: { code: 'X', message: 'boom' } } }))
    ).toBe('[!] boom');
    expect(terminalLineFromEvent(event({ type: 'analysis_completed' }))).toBe('[done] analysis completed');
    expect(terminalLineFromEvent(event({ type: 'unknown_event' }))).toBeNull();
  });
});

describe('recon event parsing', () => {
  it('retrieves the results tree from analysis_completed', () => {
    const results = reconResultsFromEvent(
      event({
        type: 'analysis_completed',
        payload: {
          status: 'COMPLETED',
          results: {
            dns: { A: ['93.184.216.34'] },
            subdomains: { total_found: 1, active: { 'www.example.com': ['93.184.216.34'] }, discovered_count: 1 }
          }
        }
      })
    );

    expect(results?.dns?.['A']).toEqual(['93.184.216.34']);
    expect(results?.subdomains?.active?.['www.example.com']).toBeDefined();
    expect(reconResultsFromEvent(event({ type: 'analysis_completed', payload: {} }))).toBeNull();
    expect(reconResultsFromEvent(event({ type: 'log' }))).toBeNull();
  });
});

describe('severityTone', () => {
  it('maps severities to Nothing status tones', () => {
    expect(severityTone('critical')).toBe('danger');
    expect(severityTone('HIGH')).toBe('danger');
    expect(severityTone('medium')).toBe('warning');
    expect(severityTone('low')).toBe('success');
    expect(severityTone('info')).toBe('neutral');
    expect(severityTone('whatever')).toBe('neutral');
  });
});
