import { Component, OnDestroy, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';

import { ApiService, SamuraiEvent, ScanDetail, ScanListItem } from '../../core/api.service';
import { LiveService } from '../../core/live.service';
import { terminalLineFromEvent } from '../../core/live-events';
import { TranslatePipe } from '../../core/translate.pipe';
import { TerminalComponent } from '../../shared/terminal/terminal.component';
import { VulnerabilitiesAnalysisSummaryComponent } from './components/analysis-summary/analysis-summary.component';
import { VulnerabilitiesFindingsReportComponent } from './components/findings-report/findings-report.component';
import { VulnerabilitiesTargetConfigComponent } from './components/target-config/target-config.component';
import { AnalysisSummary, TrendSnapshot } from './models/vulnerabilities.models';

@Component({
  selector: 'app-vulnerabilities',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    VulnerabilitiesTargetConfigComponent,
    VulnerabilitiesAnalysisSummaryComponent,
    VulnerabilitiesFindingsReportComponent,
    TerminalComponent
  ],
  templateUrl: './vulnerabilities.component.html',
  styleUrls: ['./vulnerabilities.component.scss']
})
export class VulnerabilitiesComponent implements OnInit, OnDestroy {
  targetUrl = 'http://scanme.nmap.org';
  isScanning = false;
  terminalLogs: string[] = ['[ SYSTEM READY ] Waiting for target config...'];

  authScanConfig = {
    authMode: 'bearer_first',
    bearerToken: '',
    basicUser: '',
    basicPass: '',
    cookieHeader: ''
  };

  private readonly authScanStorageKey = 'samurai-auth-scan-config';
  private liveSub: Subscription | null = null;

  activeModules: Record<string, boolean> = {
    tls: true,
    headers: true,
    cors: true,
    brute: true,
    sqli: true,
    sqlmap: true,
    xss: true,
    lfi: true,
    nuclei: true,
    playwright: true,
    api_security: true,
    auth_scan: true,
    js_secret: true
  };

  moduleOptions = [
    { key: 'tls', label: 'TLS', description: 'SSL/TLS protocol audit' },
    { key: 'headers', label: 'HEADERS', description: 'Security headers inspection' },
    { key: 'cors', label: 'CORS', description: 'Cross-origin policy validation' },
    { key: 'brute', label: 'PATH BRUTE', description: 'Sensitive path exposure checks' },
    { key: 'sqli', label: 'SQLI', description: 'Injection payloads against forms' },
    { key: 'sqlmap', label: 'SQLMAP', description: 'Automated SQLi verification via SQLMap' },
    { key: 'xss', label: 'XSS', description: 'Reflected script execution checks' },
    { key: 'lfi', label: 'LFI', description: 'Traversal/local file inclusion tests' },
    { key: 'nuclei', label: 'NUCLEI', description: 'Template-based web vulnerability matching' },
    { key: 'playwright', label: 'PLAYWRIGHT', description: 'JS surface and endpoint exposure analysis' },
    { key: 'api_security', label: 'API SECURITY', description: 'API docs/schema/method exposure and endpoint hygiene audit' },
    { key: 'auth_scan', label: 'AUTH SCAN', description: 'Authorization boundary probing on sensitive routes' },
    { key: 'js_secret', label: 'JS SECRET', description: 'Client-side JavaScript secret and token leakage analysis' }
  ];

  completedScanDetails: ScanDetail | null = null;
  trendSnapshots: TrendSnapshot[] = [];

  constructor(
    private api: ApiService,
    private live: LiveService,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.loadAuthScanConfigFromStorage();

    this.route.queryParamMap.subscribe((params) => {
      const scanId = Number(params.get('scanId'));
      if (Number.isInteger(scanId) && scanId > 0) {
        this.loadScanById(scanId);
      }

      const authModeParam = (params.get('authMode') || '').toLowerCase();
      if (authModeParam === 'basic_first' || authModeParam === 'bearer_first') {
        this.authScanConfig = {
          ...this.authScanConfig,
          authMode: authModeParam
        };
        this.cdr.markForCheck();
      }
    });
  }

  initiateCrawl() {
    if (this.isScanning) return;
    if (!this.targetUrl) return;

    this.isScanning = true;
    this.completedScanDetails = null;
    this.terminalLogs = [`[+] CONNECTING TO DAST ENGINE...`, `[*] Target: ${this.targetUrl}`];
    this.cdr.markForCheck();

    const activeKeys = this.allModulesActive
      ? 'all'
      : Object.entries(this.activeModules)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(',') || 'all';

    const wsUrl = this.api.vulnLiveUrl({
      target: this.targetUrl,
      modules: activeKeys,
      authMode: this.authScanConfig.authMode,
      bearerToken: this.authScanConfig.bearerToken,
      basicUser: this.authScanConfig.basicUser,
      basicPass: this.authScanConfig.basicPass,
      cookieHeader: this.authScanConfig.cookieHeader
    });

    this.liveSub = this.live.open(wsUrl).subscribe({
      next: (event) => {
        this.handleVulnerabilityEvent(event);
        this.cdr.markForCheck();
      },
      error: () => {
        this.terminalLogs.push('[!] WEBSOCKET CONNECTION ERROR.');
        this.isScanning = false;
        this.cdr.markForCheck();
      },
      complete: () => {
        this.terminalLogs.push('[!] CRAWLER FINISHED. Fetching database structure...');
        this.isScanning = false;
        this.cdr.markForCheck();
        this.fetchLatestScan();
      }
    });
  }

  private handleVulnerabilityEvent(event: SamuraiEvent) {
    const line = terminalLineFromEvent(event);
    if (line !== null) {
      this.terminalLogs.push(line);
    }
  }

  onAuthScanConfigChange(nextConfig: {
    authMode: string;
    bearerToken: string;
    basicUser: string;
    basicPass: string;
    cookieHeader: string;
  }) {
    const normalizedMode = nextConfig.authMode === 'basic_first' ? 'basic_first' : 'bearer_first';

    this.authScanConfig = {
      ...nextConfig,
      authMode: normalizedMode
    };

    this.persistAuthScanConfig();
  }

  private persistAuthScanConfig() {
    try {
      window.localStorage.setItem(this.authScanStorageKey, JSON.stringify(this.authScanConfig));
    } catch {
      // Storage may be unavailable in restrictive browser contexts.
    }
  }

  private loadAuthScanConfigFromStorage() {
    try {
      const raw = window.localStorage.getItem(this.authScanStorageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<{
        authMode: string;
        bearerToken: string;
        basicUser: string;
        basicPass: string;
        cookieHeader: string;
      }>;
      this.authScanConfig = {
        authMode: parsed.authMode === 'basic_first' ? 'basic_first' : 'bearer_first',
        bearerToken: parsed.bearerToken || '',
        basicUser: parsed.basicUser || '',
        basicPass: parsed.basicPass || '',
        cookieHeader: parsed.cookieHeader || ''
      };
    } catch {
      this.authScanConfig = {
        authMode: 'bearer_first',
        bearerToken: '',
        basicUser: '',
        basicPass: '',
        cookieHeader: ''
      };
    }
  }

  fetchLatestScan() {
    this.api.listScans().subscribe({
      next: (scans) => {
        if (scans && scans.length > 0) {
          this.fetchTrendFromRecentScans(scans);
          this.api.getScan(scans[0].id).subscribe({
            next: (detail) => {
              this.completedScanDetails = detail;
              this.cdr.markForCheck();
            },
            error: () => {
              this.terminalLogs.push('[!] Unable to load the latest scan report.');
              this.cdr.markForCheck();
            }
          });
        }
      },
      error: () => {
        this.terminalLogs.push('[!] Unable to load scan history.');
        this.cdr.markForCheck();
      }
    });
  }

  private loadScanById(scanId: number) {
    this.api.listScans().subscribe({
      next: (scans) => {
        this.fetchTrendFromRecentScans(scans || []);
      },
      error: () => {
        this.trendSnapshots = [];
        this.cdr.markForCheck();
      }
    });

    this.api.getScan(scanId).subscribe({
      next: (detail) => {
        this.completedScanDetails = detail;
        this.targetUrl = detail.domain_target || this.targetUrl;
        this.isScanning = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.terminalLogs.push(`[!] Unable to load scan report #${scanId}.`);
        this.isScanning = false;
        this.cdr.markForCheck();
      }
    });
  }

  toggleModule(moduleKey: string) {
    this.activeModules[moduleKey] = !this.activeModules[moduleKey];

    if (!Object.values(this.activeModules).some(Boolean)) {
      this.activeModules[moduleKey] = true;
    }
  }

  activateAllModules() {
    Object.keys(this.activeModules).forEach((key) => {
      this.activeModules[key] = true;
    });
  }

  get allModulesActive() {
    return Object.values(this.activeModules).every(Boolean);
  }

  get analysisSummary() {
    return this.buildSummary(this.completedScanDetails, this.terminalLogs.length);
  }

  get trendPolylinePoints() {
    if (!this.trendSnapshots.length) return '';

    const width = 320;
    const height = 64;
    const maxY = Math.max(...this.trendSnapshots.map((s) => s.riskScore), 1);

    return this.trendSnapshots
      .map((snap, idx) => {
        const x = this.trendSnapshots.length === 1 ? width / 2 : (idx / (this.trendSnapshots.length - 1)) * width;
        const y = height - (snap.riskScore / maxY) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  get trendLatestDelta() {
    if (this.trendSnapshots.length < 2) return null;
    return this.trendSnapshots[0].riskScore - this.trendSnapshots[1].riskScore;
  }

  private fetchTrendFromRecentScans(scans: ScanListItem[]) {
    const recent = scans.slice(0, 8).filter((s) => s?.id);
    if (!recent.length) {
      this.trendSnapshots = [];
      this.cdr.markForCheck();
      return;
    }

    forkJoin(recent.map((scan) => this.api.getScan(scan.id))).subscribe({
      next: (details) => {
        this.trendSnapshots = details.map((detail, index) => {
          const summary = this.buildSummary(detail, 0);
          const label = recent[index]?.created_at
            ? String(recent[index].created_at).slice(5, 10)
            : `#${recent[index]?.id}`;
          return {
            id: recent[index].id,
            riskScore: summary?.riskScore ?? 0,
            totalFindings: summary?.totalFindings ?? 0,
            label
          };
        });
        this.cdr.markForCheck();
      },
      error: () => {
        this.trendSnapshots = [];
        this.cdr.markForCheck();
      }
    });
  }

  private buildSummary(scanDetails: ScanDetail | null, terminalEvents: number): AnalysisSummary | null {
    if (!scanDetails) return null;

    const links = scanDetails.discovered_links || [];
    const totalLinks = links.length;

    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let vulnerableLinks = 0;

    links.forEach((link) => {
      const findings = link.findings || [];
      if (findings.length > 0) {
        vulnerableLinks++;
      }

      findings.forEach((finding) => {
        if (finding.severity === 'critical') critical++;
        else if (finding.severity === 'high') high++;
        else if (finding.severity === 'medium') medium++;
        else low++;
      });
    });

    const totalFindings = critical + high + medium + low;
    const cleanLinks = Math.max(totalLinks - vulnerableLinks, 0);
    const coveragePct = totalLinks > 0 ? Math.round((vulnerableLinks / totalLinks) * 100) : 0;

    const weightedRisk = critical * 4 + high * 3 + medium * 2 + low;
    const riskDenominator = Math.max(totalLinks * 4, 1);
    const riskScore = Math.min(100, Math.round((weightedRisk / riskDenominator) * 100));

    const avgFindingsPerLink = totalLinks > 0 ? (totalFindings / totalLinks).toFixed(1) : '0.0';

    return {
      totalLinks,
      vulnerableLinks,
      cleanLinks,
      totalFindings,
      critical,
      high,
      medium,
      low,
      coveragePct,
      riskScore,
      avgFindingsPerLink,
      terminalEvents
    };
  }

  ngOnDestroy() {
    this.liveSub?.unsubscribe();
  }
}
