import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { TranslatePipe } from '../../../../core/translate.pipe';
import { MetricCardComponent } from '../../../../shared/metric-card/metric-card.component';

@Component({
  selector: 'app-scanner-metrics',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MetricCardComponent],
  templateUrl: './scanner-metrics.component.html',
  styleUrls: ['./scanner-metrics.component.scss']
})
export class ScannerMetricsComponent {
  @Input() vulnerabilitiesFound = 0;
  @Input() contactsFound = 0;
  @Input() unsanitizedFindings = 0;
  @Input() latestOpenPortDelta: number | null = null;
  @Input() openPortsDetailed: Array<{ token: string; service: string; version: string }> = [];
}
