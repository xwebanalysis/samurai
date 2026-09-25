import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ThemeService } from './core/theme.service';
import { TranslationService } from './core/i18n.service';
import { TranslatePipe } from './core/translate.pipe';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  public themeService = inject(ThemeService);
  public translationService = inject(TranslationService);
  public authService = inject(AuthService);

  authPassword = '';

  ngOnInit(): void {
    this.themeService.initTheme();
    this.translationService.initLang();
    this.authService.refreshAuthStatus();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  toggleLang(): void {
    this.translationService.toggleLang();
  }

  submitLogin(event: Event): void {
    event.preventDefault();
    if (!this.authPassword.trim()) return;
    this.authService.login(this.authPassword.trim()).subscribe((response) => {
      if (response?.token) {
        // Reload so every feature re-fetches with the fresh bearer token.
        window.location.reload();
      }
    });
  }

  logout(): void {
    this.authService.logout();
    window.location.reload();
  }
}
