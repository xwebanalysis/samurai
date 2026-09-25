import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../../core/translate.pipe';
import { MetricCardComponent } from '../../../../shared/metric-card/metric-card.component';
import {
  XwaChartComponent,
  XwaChartDatum
} from '../../../../shared/charts/xwa-chart.component';
import { AnalysisSummary, TrendSnapshot } from '../../models/vulnerabilities.models';

@Component({
  selector: 'app-vuln-analysis-summary',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MetricCardComponent, XwaChartComponent],
  templateUrl: './analysis-summary.component.html',
  styleUrls: ['./analysis-summary.component.scss']
})
export class VulnerabilitiesAnalysisSummaryComponent {
  @Input() summary: AnalysisSummary | null = null;
  @Input() trendSnapshots: TrendSnapshot[] = [];
  @Input() trendPolylinePoints = '';
  @Input() trendLatestDelta: number | null = null;

  get severityChartData(): XwaChartDatum[] {
    if (!this.summary) return [];
    return [
      { label: 'CRITICAL', value: this.summary.critical, color: 'critical' },
      { label: 'HIGH', value: this.summary.high, color: 'warning' },
      { label: 'MEDIUM', value: this.summary.medium, color: 'neutral-strong' },
      { label: 'LOW', value: this.summary.low, color: 'success' }
    ];
  }

  get totalFindingsSegments() {
    if (!this.summary) return [];
    const value = this.summary.totalFindings > 0 ? Math.min(100, this.summary.totalFindings * 5) : 0;
    return this.buildSegments(value, 20);
  }

  get riskSegments() {
    if (!this.summary) return [];
    return this.buildSegments(this.summary.riskScore, 20);
  }

  get coverageSegments() {
    if (!this.summary) return [];
    return this.buildSegments(this.summary.coveragePct, 20);
  }

  severitySegments(value: number, total: number) {
    if (!total) return this.buildSegments(0, 14);
    return this.buildSegments(Math.round((value / total) * 100), 14);
  }

  private buildSegments(percent: number, segmentCount: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * segmentCount);
    return Array.from({ length: segmentCount }, (_, idx) => idx < filled);
  }
}
