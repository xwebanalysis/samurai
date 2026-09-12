import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Subscription } from 'rxjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { gzip } from 'pako';

import { ApiService, SamuraiEvent, ScanDetail, ScanListItem } from '../../core/api.service';
import { LiveService } from '../../core/live.service';
import {
  OpenPortDetail,
  contactProgressFromEvent,
  openPortDetailFromLogLine,
  openPortFromEvent,
  openPortFromPayload,
  openPortTokenFromLogLine,
  scanIdFromLogLine,
  unsanitizedFromEvent
} from '../../core/live-events';
import { TranslationService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { ExportActionsComponent } from '../../shared/export-actions/export-actions.component';
import { TerminalComponent } from '../../shared/terminal/terminal.component';
import { ScannerTargetConfigComponent } from './components/target-config/scanner-target-config.component';
import { ScannerMetricsComponent } from './components/metrics/scanner-metrics.component';
import { ScannerHistoryComponent } from './components/history/scanner-history.component';
import { ScannerReportComponent } from './components/report/scanner-report.component';

interface ScannerHistoryItem {
  id: number;
  target: string;
  status: string;
  openPorts: number;
  contacts: number;
  unsanitized: number;
  createdAt: string;
}

export interface ScannerExportRow {
  node_type: 'global' | 'link';
  host: string;
  url: string;
  status_code: number;
  content_type: string;
  finding_type: string;
  severity: string;
  cvss_score: string;
  description: string;
  poc_payload: string;
}

export interface ScannerReportExportSnapshot {
  rows: ScannerExportRow[];
  hasActiveFilters: boolean;
  filters: {
    searchText: string;
    severity: 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info';
    scope: 'all' | 'global' | 'link';
    findingType: string;
  };
}

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [
    CommonModule,
    ScannerTargetConfigComponent,
    ScannerMetricsComponent,
    ScannerHistoryComponent,
    ScannerReportComponent,
    TerminalComponent,
    ExportActionsComponent,
    TranslatePipe
  ],
  templateUrl: './scanner.component.html',
  styleUrls: ['./scanner.component.scss']
})
export class ScannerComponent implements OnInit, OnDestroy {
  targetDomain = 'scanme.nmap.org';
  scanProfile: 'quick' | 'balanced' | 'deep' | 'udp' = 'quick';
  scanTimeout = 180;
  webAppSurfaceScan = true;
  collectContactIntel = true;
  detectUnsanitizedInputs = true;
  webMaxPages = 12;
  isScanning = false;
  terminalLogs: string[] = ['[ SYSTEM READY ] Waiting for target config...'];

  vulnerabilitiesFound = 0;
  contactsFound = 0;
  unsanitizedFindings = 0;
  currentScanId: number | null = null;
  latestOpenPortDelta: number | null = null;
  scannerHistory: ScannerHistoryItem[] = [];
  openPortsDetailed: OpenPortDetail[] = [];
  currentScanDetail: ScanDetail | null = null;
  filteredExportRows: ScannerExportRow[] | null = null;
  reportFilterSnapshot: ScannerReportExportSnapshot['filters'] | null = null;
  reportHasActiveFilters = false;

  private openPortsSet = new Set<string>();
  private liveSub: Subscription | null = null;
  private readonly maxTerminalLines = 1200;

  constructor(
    private cdr: ChangeDetectorRef,
    private api: ApiService,
    private live: LiveService,
    private route: ActivatedRoute,
    public translationService: TranslationService
  ) {}

  ngOnInit() {
    this.loadScannerHistory();
    this.route.queryParams.subscribe((params) => {
      const scanId = Number(params['scanId']);
      if (Number.isFinite(scanId) && scanId > 0) {
        this.currentScanId = scanId;
        this.loadCurrentScanDetail(scanId);
      }
    });
  }

  initiateScan() {
    if (this.isScanning) return;
    if (!this.targetDomain) return;

    this.isScanning = true;
    this.terminalLogs = [
      `[+] CONNECTING TO ENGINE FOR SCANNING: ${this.targetDomain}...`,
      `[i] PROFILE=${this.scanProfile} | TIMEOUT=${this.scanTimeout}s | WEB_SCAN=${this.webAppSurfaceScan}`,
      `[i] CONTACT_INTEL=${this.collectContactIntel} | UNSANITIZED_INPUTS=${this.detectUnsanitizedInputs} | MAX_WEB_PAGES=${this.webMaxPages}`,
      '[i] Open ports will be listed with service/version details as they are discovered.'
    ];
    this.vulnerabilitiesFound = 0;
    this.contactsFound = 0;
    this.unsanitizedFindings = 0;
    this.currentScanId = null;
    this.currentScanDetail = null;
    this.openPortsSet.clear();
    this.openPortsDetailed = [];
    this.cdr.markForCheck();

    const wsUrl = this.api.scannerLiveUrl({
      target: this.targetDomain,
      profile: this.scanProfile,
      timeout: this.scanTimeout,
      webScan: this.webAppSurfaceScan,
      collectContacts: this.collectContactIntel,
      scanUnsanitized: this.detectUnsanitizedInputs,
      maxPages: this.webMaxPages
    });

    this.liveSub = this.live.open(wsUrl).subscribe({
      next: (event) => {
        this.handleScannerEvent(event);
        this.cdr.markForCheck();
      },
      error: () => {
        this.terminalLogs.push('[!] WEBSOCKET CONNECTION ERROR.');
        this.finishScan();
      },
      complete: () => {
        this.terminalLogs.push('[!] CONNECTION CLOSED. Scan finished.');
        this.finishScan();
      }
    });
  }

  selectScannerHistoryRun(scanId: number) {
    this.currentScanId = scanId;
    this.loadCurrentScanDetail(scanId);
  }

  cancelScan() {
    if (!this.currentScanId || !this.isScanning) return;

    this.api.cancelScan(this.currentScanId).subscribe({
      next: () => {
        this.terminalLogs.push(`[!] Cancellation requested for scan #${this.currentScanId}`);
        this.cdr.markForCheck();
      },
      error: () => {
        this.terminalLogs.push('[!] Failed to cancel scan.');
        this.cdr.markForCheck();
      }
    });
  }

  onReportExportSnapshot(snapshot: ScannerReportExportSnapshot) {
    this.filteredExportRows = snapshot.rows;
    this.reportFilterSnapshot = snapshot.filters;
    this.reportHasActiveFilters = snapshot.hasActiveFilters;
  }

  exportScannerAsJson() {
    const payload = this.buildScannerExportPayload();
    this.downloadTextFile(
      `samurai-scanner-${payload.currentScanId ?? 'latest'}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  }

  exportScannerAsCsv() {
    const rows = this.flattenScannerExportRows();
    const headers = [
      'node_type',
      'host',
      'url',
      'status_code',
      'content_type',
      'finding_type',
      'severity',
      'cvss_score',
      'description',
      'poc_payload'
    ];
    const csvLines = [headers.join(',')];

    rows.forEach((row) => {
      csvLines.push(headers.map((header) => this.escapeCsv(row[header as keyof ScannerExportRow])).join(','));
    });

    this.downloadTextFile(
      `samurai-scanner-${this.currentScanId ?? 'latest'}.csv`,
      csvLines.join('\n'),
      'text/csv;charset=utf-8'
    );
  }

  exportScannerAsPdf() {
    const rows = this.flattenScannerExportRows();
    const payload = this.buildScannerExportPayload();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    const t = (k: string) => this.translationService.translate(k);
    doc.setFontSize(14);
    doc.text(t('Samurai Scanner Report'), 40, 36);
    doc.setFontSize(10);
    doc.text(`${t('Target:')} ${payload.target}`, 40, 54);
    doc.text(`${t('Profile:')} ${payload.profile} | ${t('Timeout:')} ${payload.timeout}s`, 40, 68);
    doc.text(`${t('Exported:')} ${payload.exportedAt}`, 40, 82);

    autoTable(doc, {
      startY: 96,
      head: [[t('Node'), t('Host'), t('URL'), t('Status'), t('Content Type'), t('Finding Type'), t('Severity'), 'CVSS', t('Description'), t('PoC')]],
      body: rows.map((row) => [
        row.node_type,
        row.host,
        row.url,
        String(row.status_code),
        row.content_type,
        row.finding_type,
        row.severity,
        row.cvss_score,
        row.description,
        row.poc_payload
      ]),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [35, 35, 35] }
    });

    doc.save(`samurai-scanner-${this.currentScanId ?? 'latest'}.pdf`);
  }

  exportScannerAsBinary() {
    const payload = this.buildScannerExportPayload();
    const bytes = gzip(JSON.stringify(payload));
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `samurai-scanner-${this.currentScanId ?? 'latest'}.bin`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy() {
    this.liveSub?.unsubscribe();
  }

  private finishScan() {
    this.isScanning = false;
    if (this.currentScanId) {
      this.loadCurrentScanDetail(this.currentScanId);
    }
    this.loadScannerHistory();
    this.cdr.markForCheck();
  }

  private handleScannerEvent(event: SamuraiEvent) {
    const scanId = Number(event.analysis_id);
    if (Number.isFinite(scanId) && scanId > 0) {
      this.currentScanId = scanId;
    }

    switch (event.type) {
      case 'log': {
        const line = String(event.payload?.line ?? '');
        this.pushTerminalLine(line);
        this.captureLegacyLogLine(line);
        break;
      }
      case 'analysis_progress': {
        const contact = contactProgressFromEvent(event);
        if (contact) {
          this.contactsFound += contact.total;
          this.pushTerminalLine(
            `    [WEB_CONTACT] ${contact.url} emails=${contact.emails} phones=${contact.phones}`
          );
        }
        break;
      }
      case 'item_found': {
        const openPort = openPortFromEvent(event);
        if (openPort) {
          this.openPortsSet.add(openPort.token);
          this.vulnerabilitiesFound = this.openPortsSet.size;
          if (!this.openPortsDetailed.some((entry) => entry.token === openPort.token)) {
            this.openPortsDetailed.push(openPort);
          }
          this.pushTerminalLine(
            `[OPEN_PORT] ${openPort.token} ${openPort.service} ${openPort.version}`
          );
          break;
        }

        const unsanitized = unsanitizedFromEvent(event);
        if (unsanitized) {
          this.unsanitizedFindings += unsanitized.reflected ? 1 : unsanitized.forms;
          this.pushTerminalLine(
            `    [WEB_UNSANITIZED] ${unsanitized.url} ${
              unsanitized.reflected ? 'reflected=true' : `forms=${unsanitized.forms}`
            }`
          );
        }
        break;
      }
      case 'analysis_error': {
        const error = event.payload?.error;
        this.pushTerminalLine(`[!] ${error?.message || 'Analysis error'}`);
        break;
      }
      default:
        break;
    }
  }

  /** Legacy plain-text fallbacks for old backend builds. */
  private captureLegacyLogLine(line: string) {
    const detailed = openPortDetailFromLogLine(line);
    if (detailed && !this.openPortsDetailed.some((entry) => entry.token === detailed.token)) {
      this.openPortsDetailed.push(detailed);
    }

    const portToken = openPortTokenFromLogLine(line);
    if (portToken) {
      this.openPortsSet.add(portToken);
      this.vulnerabilitiesFound = this.openPortsSet.size;
    }

    const scanId = scanIdFromLogLine(line);
    if (scanId) {
      this.currentScanId = scanId;
    }

    this.captureLegacyWebFindings(line);
  }

  private captureLegacyWebFindings(line: string) {
    if (line.includes('[WEB_CONTACT]')) {
      const emails = Number((line.match(/emails=(\d+)/i) || [])[1] || '0');
      const phones = Number((line.match(/phones=(\d+)/i) || [])[1] || '0');
      this.contactsFound += emails + phones;
    }

    if (line.includes('[WEB_UNSANITIZED]')) {
      const forms = Number((line.match(/forms=(\d+)/i) || [])[1] || '0');
      const reflected = /reflected=true/i.test(line) ? 1 : 0;
      this.unsanitizedFindings += forms + reflected;
    }
  }

  private pushTerminalLine(line: string) {
    if (line === undefined || line === null) return;
    this.terminalLogs.push(line);
    if (this.terminalLogs.length > this.maxTerminalLines) {
      this.terminalLogs = this.terminalLogs.slice(-this.maxTerminalLines);
    }
  }

  private loadCurrentScanDetail(scanId: number) {
    this.api.getScan(scanId).subscribe({
      next: (detail) => {
        this.currentScanDetail = detail;
        this.currentScanId = detail.id;
        const findings = detail.findings || [];
        this.vulnerabilitiesFound = findings.filter((finding) => finding.finding_type === 'OPEN_PORT').length;
        this.contactsFound = findings.filter((finding) => finding.finding_type === 'CONTACT_INFO_DISCLOSURE').length;
        this.unsanitizedFindings = findings.filter(
          (finding) =>
            finding.finding_type === 'UNSANITIZED_INPUT_CANDIDATE' ||
            finding.finding_type === 'REFLECTED_INPUT_ECHO'
        ).length;
        this.openPortsDetailed = findings
          .filter((finding) => finding.finding_type === 'OPEN_PORT')
          .map((finding) => openPortFromPayload(finding.poc_payload));
        this.terminalLogs.push(
          `[REPORT] Detailed report loaded: links=${detail.discovered_links.length} | findings=${findings.length}`
        );
        this.cdr.markForCheck();
      },
      error: () => {
        this.terminalLogs.push('[!] Unable to load detailed scan report.');
        this.cdr.markForCheck();
      }
    });
  }

  private loadScannerHistory() {
    this.api.listScans().subscribe({
      next: (scans) => {
        const scannerRuns = (scans || [])
          .filter((s) => (s.scan_type || '').startsWith('port_scan'))
          .slice(0, 6);
        if (!scannerRuns.length) {
          this.scannerHistory = [];
          this.latestOpenPortDelta = null;
          this.cdr.markForCheck();
          return;
        }

        forkJoin(scannerRuns.map((s) => this.api.getScan(s.id))).subscribe({
          next: (details) => {
            this.scannerHistory = details.map((detail) => {
              const findings = detail.findings || [];
              const openPorts = findings.filter((f) => f.finding_type === 'OPEN_PORT').length;
              const contacts = findings.filter((f) => f.finding_type === 'CONTACT_INFO_DISCLOSURE').length;
              const unsanitized = findings.filter(
                (f) =>
                  f.finding_type === 'UNSANITIZED_INPUT_CANDIDATE' ||
                  f.finding_type === 'REFLECTED_INPUT_ECHO'
              ).length;
              return {
                id: detail.id,
                target: detail.domain_target,
                status: detail.status,
                openPorts,
                contacts,
                unsanitized,
                createdAt: detail.created_at || ''
              };
            });

            this.latestOpenPortDelta =
              this.scannerHistory.length > 1
                ? this.scannerHistory[0].openPorts - this.scannerHistory[1].openPorts
                : null;

            this.cdr.markForCheck();
          },
          error: () => {
            this.scannerHistory = [];
            this.latestOpenPortDelta = null;
            this.cdr.markForCheck();
          }
        });
      },
      error: () => {
        this.scannerHistory = [];
        this.latestOpenPortDelta = null;
        this.cdr.markForCheck();
      }
    });
  }

  private buildScannerExportPayload() {
    const detail = this.currentScanDetail;
    return {
      currentScanId: this.currentScanId,
      target: this.targetDomain,
      profile: this.scanProfile,
      timeout: this.scanTimeout,
      webAppSurfaceScan: this.webAppSurfaceScan,
      collectContactIntel: this.collectContactIntel,
      detectUnsanitizedInputs: this.detectUnsanitizedInputs,
      webMaxPages: this.webMaxPages,
      exportedAt: new Date().toISOString(),
      metrics: {
        portsFound: this.vulnerabilitiesFound,
        contactsFound: this.contactsFound,
        unsanitizedFindings: this.unsanitizedFindings,
        latestOpenPortDelta: this.latestOpenPortDelta
      },
      exportScope: this.reportHasActiveFilters ? 'filtered-view' : 'full-report',
      activeFilters: this.reportFilterSnapshot,
      detailedReport: detail,
      flattenedFindings: this.flattenScannerExportRows(),
      terminalLogs: this.terminalLogs
    };
  }

  private flattenScannerExportRows(): ScannerExportRow[] {
    if (this.filteredExportRows) {
      return [...this.filteredExportRows];
    }

    const detail = this.currentScanDetail;
    if (!detail) return [];

    const rows: ScannerExportRow[] = [];

    (detail.findings || []).forEach((finding) => {
      if (finding.link_id === null || finding.link_id === undefined) {
        rows.push({
          node_type: 'global',
          host: this.targetDomain,
          url: detail.domain_target,
          status_code: 200,
          content_type: 'SCAN_SCOPE',
          finding_type: finding.finding_type,
          severity: finding.severity,
          cvss_score: finding.cvss_score || '',
          description: finding.description,
          poc_payload: finding.poc_payload || ''
        });
      }
    });

    (detail.discovered_links || []).forEach((link) => {
      link.findings.forEach((finding) => {
        rows.push({
          node_type: 'link',
          host: this.getHost(link.url),
          url: link.url,
          status_code: link.status_code,
          content_type: link.content_type,
          finding_type: finding.finding_type,
          severity: finding.severity,
          cvss_score: finding.cvss_score || '',
          description: finding.description,
          poc_payload: finding.poc_payload || ''
        });
      });
    });

    return rows;
  }

  private getHost(url: string) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private escapeCsv(value: string | number | null | undefined) {
    const normalized = value === null || value === undefined ? '' : String(value);
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private downloadTextFile(fileName: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
