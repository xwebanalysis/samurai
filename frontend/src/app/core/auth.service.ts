import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { HealthResponse } from './api.service';

const TOKEN_KEY = 'samurai-token';

/**
 * Optional JWT authentication. When the backend has ``SAMURAI_JWT_SECRET``
 * set, ``authEnabled`` becomes true and the sidebar shows a login form; the
 * token is attached to every REST call and appended to WebSocket URLs.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiBaseUrl;

  readonly token = signal<string | null>(this.readStoredToken());
  readonly authEnabled = signal<boolean>(false);
  readonly loginError = signal<string | null>(null);
  readonly loginBusy = signal<boolean>(false);

  private readStoredToken(): string | null {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  refreshAuthStatus(): void {
    this.http.get<HealthResponse>(`${this.apiUrl}/api/health`).subscribe({
      next: (health) => {
        const enabled = health.authEnabled ?? health.auth_enabled ?? false;
        this.authEnabled.set(Boolean(enabled));
        if (!enabled && this.token()) {
          this.logout();
        }
      },
      error: () => {
        // Backend unreachable: keep the current state.
      }
    });
  }

  login(password: string): Observable<{ token: string }> {
    this.loginBusy.set(true);
    this.loginError.set(null);
    return this.http
      .post<{ token: string }>(`${this.apiUrl}/api/auth/login`, { password })
      .pipe(
        tap({
          next: (response) => {
            this.token.set(response.token);
            try {
              window.localStorage.setItem(TOKEN_KEY, response.token);
            } catch {
              // Storage unavailable: keep the token in memory only.
            }
            this.loginBusy.set(false);
          },
          error: () => {
            this.loginBusy.set(false);
            this.loginError.set('invalid-credentials');
          }
        })
      );
  }

  logout(): void {
    this.token.set(null);
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Ignore storage errors.
    }
  }

  /** Authorization header for REST calls (empty object when no token). */
  authHeaders(): Record<string, string> {
    const token = this.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Append the token as a query param when a session exists. */
  appendToken(url: string): string {
    const token = this.token();
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
}
