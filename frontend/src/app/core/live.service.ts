import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { SamuraiEvent } from './api.service';
import { parseEventEnvelope } from './live-events';

export interface LiveOpenInfo {
  index: number;
  url: string;
}

export interface LiveOptions {
  /** Emit a transport error when no frame arrives within this window. */
  inactivityMs?: number;
  /** Notified every time a socket opens (including proxy fallbacks). */
  onOpen?: (info: LiveOpenInfo) => void;
}

/**
 * Unified WebSocket transport for the three samurai live streams
 * (``/api/scan/live``, ``/api/vuln/live``, ``/api/recon/live``).
 *
 * Every frame is parsed as an xwa-sdk ``Event`` envelope. Frames that are not
 * valid JSON fall back to a synthetic ``log`` event so old plain-text backends
 * keep rendering in the terminal. ``openWithFallback`` retries the next URL
 * (direct backend → same-origin proxy) when the first connection never opens.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  open(url: string, options: LiveOptions = {}): Observable<SamuraiEvent> {
    return this.openWithFallback([url], options);
  }

  openWithFallback(urls: string[], options: LiveOptions = {}): Observable<SamuraiEvent> {
    return new Observable<SamuraiEvent>((subscriber) => {
      let socket: WebSocket | null = null;
      let hasOpened = false;
      let receivedFrame = false;
      let closedByClient = false;
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

      const clearTimer = (): void => {
        if (inactivityTimer !== null) {
          clearTimeout(inactivityTimer);
          inactivityTimer = null;
        }
      };

      const armTimer = (): void => {
        clearTimer();
        if (!options.inactivityMs) return;
        inactivityTimer = setTimeout(() => {
          teardown();
          subscriber.error(
            new Error('No response from live engine. Check backend logs or restart the scan.')
          );
        }, options.inactivityMs);
      };

      const teardown = (): void => {
        clearTimer();
        if (!socket) return;
        const current = socket;
        socket = null;
        current.onopen = null;
        current.onmessage = null;
        current.onerror = null;
        current.onclose = null;
        try {
          current.close(1000, 'client closed');
        } catch {
          // Socket may already be closed by the server.
        }
      };

      const connect = (index: number): void => {
        if (closedByClient) return;

        hasOpened = false;
        receivedFrame = false;

        const current = new WebSocket(urls[index]);
        socket = current;

        current.onopen = () => {
          if (socket !== current) return;
          hasOpened = true;
          options.onOpen?.({ index, url: urls[index] });
          armTimer();
        };

        current.onmessage = (message) => {
          if (socket !== current) return;
          receivedFrame = true;
          armTimer();

          const event = parseEventEnvelope(message.data);
          if (event) {
            subscriber.next(event);
            return;
          }

          const text = typeof message.data === 'string' ? message.data : String(message.data);
          if (text.trim()) {
            subscriber.next(legacyLogEvent(text));
          }
        };

        current.onerror = () => {
          if (socket !== current) return;
          if (!hasOpened && !receivedFrame && index + 1 < urls.length) {
            connect(index + 1);
            return;
          }
          teardown();
          subscriber.error(new Error('WebSocket connection error'));
        };

        current.onclose = (event) => {
          if (socket !== current) return;
          clearTimer();

          if (!hasOpened && !receivedFrame && index + 1 < urls.length) {
            connect(index + 1);
            return;
          }

          socket = null;
          if (event.wasClean || !hasOpened) {
            subscriber.complete();
          } else {
            subscriber.error(new Error(`WebSocket closed with code ${event.code}`));
          }
        };
      };

      connect(0);

      return () => {
        closedByClient = true;
        teardown();
      };
    });
  }
}

/** Wrap a legacy plain-text frame in a synthetic xwa-sdk ``log`` event. */
function legacyLogEvent(line: string): SamuraiEvent {
  return {
    seq: 0,
    type: 'log',
    tool: 'samurai',
    analysis_id: '',
    ts: new Date().toISOString(),
    payload: { line }
  };
}
