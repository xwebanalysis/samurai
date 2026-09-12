import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { TranslationService } from './core/i18n.service';
import { TranslatePipe } from './core/translate.pipe';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  constructor(
    public themeService: ThemeService,
    public translationService: TranslationService
  ) {}

  ngOnInit(): void {
    this.themeService.initTheme();
    this.translationService.initLang();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  toggleLang(): void {
    this.translationService.toggleLang();
  }
}
