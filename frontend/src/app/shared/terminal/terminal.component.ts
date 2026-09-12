import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { TranslatePipe } from '../../core/translate.pipe';

/**
 * Nothing-style live terminal panel shared by scanner, recon and DAST.
 * Bracket/plain `[LOADING...]` semantics only: no skeletons, no shadows.
 */
@Component({
  selector: 'app-terminal',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './terminal.component.html',
  styleUrls: ['./terminal.component.scss']
})
export class TerminalComponent {
  @Input() title = 'LIVE_TERMINAL_OUTPUT';
  @Input() logs: string[] = [];
  @Input() isScanning = false;
  @Input() ariaLabel = 'Terminal output';
  @Input() height = 400;
  @Input() showStatus = false;
}
