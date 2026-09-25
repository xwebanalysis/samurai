import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { TranslatePipe } from '../../../../core/translate.pipe';
import { MetricCardComponent } from '../../../../shared/metric-card/metric-card.component';
import {
  XwaChartComponent,
  XwaChartDatum
} from '../../../../shared/charts/xwa-chart.component';

@Component({
  selector: 'app-scanner-metrics',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MetricCardComponent, XwaChartComponent],
  templateUrl: './scanner-metrics.component.html',
  styleUrls: ['./scanner-metrics.component.scss']
})
export class ScannerMetricsComponent {
  @Input() vulnerabilitiesFound = 0;
  @Input() contactsFound = 0;
  @Input() unsanitizedFindings = 0;
  @Input() latestOpenPortDelta: number | null = null;
  @Input() openPortsDetailed: Array<{ token: string; service: string; version: string }> = [];

  get surfaceChartData(): XwaChartDatum[] {
    return [
      { label: 'OPEN PORTS', value: this.vulnerabilitiesFound, color: 'info' },
      { label: 'CONTACTS', value: this.contactsFound, color: 'warning' },
      { label: 'UNSANITIZED', value: this.unsanitizedFindings, color: 'critical' }
    ];
  }
}
