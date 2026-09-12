import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { ApiService, ScanListItem } from '../../core/api.service';
import { TranslatePipe } from '../../core/translate.pipe';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss']
})
export class HistoryComponent implements OnInit {
  scans: ScanListItem[] = [];
  selectedScan: ScanListItem | null = null;
  isLoading = true;

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
