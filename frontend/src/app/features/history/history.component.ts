import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { ApiService, ScanListItem } from '../../core/api.service';
import { TranslatePipe } from '../../core/translate.pipe';
import {
  XwaChartComponent,
  XwaChartColorKey,
  XwaChartDatum
} from '../../shared/charts/xwa-chart.component';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe, XwaChartComponent],
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss']
})
export class HistoryComponent implements OnInit {
  scans: ScanListItem[] = [];
  selectedScan: ScanListItem | null = null;
  isLoading = true;

  get statusChartData(): XwaChartDatum[] {
    const counts = new Map<string, number>();
    for (const scan of this.scans) {
      const key = String(scan.status || 'UNKNOWN').toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, value]) => ({
      label,
      value,
      color: this.statusColor(label)
    }));
  }

  get scansPerDayData(): XwaChartDatum[] {
    const byDay = new Map<string, number>();
    for (const scan of this.scans) {
      const day = String(scan.created_at || '').slice(0, 10) || 'UNKNOWN';
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value }));
  }

  private statusColor(status: string): XwaChartColorKey {
    if (status === 'COMPLETED') return 'success';
    if (status === 'RUNNING' || status === 'PENDING') return 'warning';
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR') return 'critical';
    return 'neutral-strong';
  }

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit() {
    this.fetchHistory();
  }

  fetchHistory() {
    this.isLoading = true;
    this.api.listScans().subscribe({
      next: (data) => {
        this.scans = data;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error fetching history:', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  deleteScan(id: number, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this scan and all its findings?')) return;

    this.api.deleteScan(id).subscribe({
      next: () => {
        // Optimistic UI update
        this.scans = this.scans.filter((s) => s.id !== id);
        if (this.selectedScan && this.selectedScan.id === id) {
          this.selectedScan = null;
        }
        this.cdr.markForCheck();
      },
      error: (err) => console.error('Delete error', err)
    });
  }

  viewDetails(id: number) {
    this.api.getScan(id).subscribe({
      next: (data) => {
        this.selectedScan = data;
        this.cdr.markForCheck();
      },
      error: (err) => console.error('Detail error', err)
    });
  }

  openScanInModule(scan: ScanListItem) {
    const route = this.resolveRouteByScan(scan);
    this.router.navigate([route], { queryParams: { scanId: scan.id } });
  }

  private resolveRouteByScan(scan: ScanListItem): string {
    const type = String(scan.scan_type || '').toLowerCase();
    if (type.includes('crawler') || (scan.discovered_links && scan.discovered_links.length > 0)) {
      return '/vulnerabilities';
    }
    if (type.includes('recon')) {
      return '/recon';
    }
    return '/scanner';
  }
}
