import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ApiService } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should GET the health endpoint', () => {
    service.health().subscribe((health) => {
      expect(health.tool).toBe('samurai');
      expect(health.database).toBe('ok');
    });

    const request = httpMock.expectOne('http://localhost:8000/api/health');
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'ok', database: 'ok', version: '2.5.0', tool: 'samurai' });
  });

  it('should list, fetch and delete scans', () => {
    service.listScans().subscribe((items) => expect(items).toEqual([]));
    httpMock.expectOne('http://localhost:8000/api/scans').flush([]);

    service.getScan(7).subscribe((scan) => expect(scan.id).toBe(7));
    httpMock.expectOne('http://localhost:8000/api/scans/7').flush({ id: 7, discovered_links: [] });

    service.deleteScan(7).subscribe();
    const deletion = httpMock.expectOne('http://localhost:8000/api/scans/7');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush({ status: 'deleted', scan_id: 7 });
  });

  it('should POST the scan cancellation', () => {
    service.cancelScan(12).subscribe();
    const request = httpMock.expectOne('http://localhost:8000/api/scan/cancel/12');
    expect(request.request.method).toBe('POST');
    request.flush({ status: 'cancellation-requested', scan_id: 12 });
  });

  it('should request raw and encrypted database exports', () => {
    service.exportDatabaseRaw().subscribe();
    const raw = httpMock.expectOne('http://localhost:8000/api/database/export/raw');
    expect(raw.request.method).toBe('GET');
    raw.flush(new Blob(['{}'], { type: 'application/json' }));

    service.exportDatabaseEncrypted('secret').subscribe();
    const encrypted = httpMock.expectOne('http://localhost:8000/api/database/export/encrypted');
    expect(encrypted.request.method).toBe('POST');
    expect(encrypted.request.body).toEqual({ password: 'secret' });
    encrypted.flush(new Blob(['bin'], { type: 'application/octet-stream' }));
  });

  it('should build the server-side analysis export URL', () => {
    expect(service.analysisExportUrl(12, 'json')).toBe(
      'http://localhost:8000/api/analyses/12/export?format=json'
    );
    expect(service.analysisExportUrl(12, 'csv')).toBe(
      'http://localhost:8000/api/analyses/12/export?format=csv'
    );
  });

  it('should build the scanner live WebSocket URL', () => {
    const url = service.scannerLiveUrl({
      target: 'scanme.nmap.org',
      profile: 'deep',
      timeout: 180,
      webScan: true,
      collectContacts: false,
      scanUnsanitized: true,
      maxPages: 12
    });

    expect(url).toContain('ws://localhost:8000/api/scan/live?');
    expect(url).toContain('target=scanme.nmap.org');
    expect(url).toContain('profile=deep');
    expect(url).toContain('timeout=180');
    expect(url).toContain('web_scan=true');
    expect(url).toContain('collect_contacts=false');
    expect(url).toContain('scan_unsanitized=true');
    expect(url).toContain('max_pages=12');
  });

  it('should build the DAST live WebSocket URL with auth context', () => {
    const url = service.vulnLiveUrl({
      target: 'https://example.com/a b',
      modules: 'tls,headers',
      authMode: 'basic_first',
      bearerToken: 'token-123',
      basicUser: 'admin',
      basicPass: 'p@ss',
      cookieHeader: 'sid=1'
    });

    expect(url).toContain('ws://localhost:8000/api/vuln/live?');
    expect(url).toContain('target=https%3A%2F%2Fexample.com%2Fa+b');
    expect(url).toContain('modules=tls%2Cheaders');
    expect(url).toContain('auth_mode=basic_first');
    expect(url).toContain('auth_bearer=token-123');
    expect(url).toContain('auth_user=admin');
    expect(url).toContain('auth_pass=p%40ss');
    expect(url).toContain('auth_cookie=sid%3D1');
  });

  it('should build recon live URLs with same-origin fallback', () => {
    const urls = service.reconLiveUrls({ target: 'example.com', modules: ['dns', 'tech'], timeout: 300 });

    expect(urls.length).toBe(2);
    expect(urls[0]).toBe('ws://localhost:8000/api/recon/live?target=example.com&recon_types=dns%2Ctech&timeout=300');
    expect(urls[1]).toContain(`${window.location.host}/api/recon/live?`);
  });
});
