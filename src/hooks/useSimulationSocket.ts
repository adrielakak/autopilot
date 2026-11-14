import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ConnectionStatus, MapData, SimCommand, SimState } from '../types/simulation';

interface UseSimulationSocketResult {
  uiState: SimState | null;
  mapData: MapData | null;
  stateRef: RefObject<SimState | null>;
  mapRef: RefObject<MapData | null>;
  status: ConnectionStatus;
  fps: number;
  sendCommand: (command: SimCommand) => void;
}

function getBackendUrls(): { wsUrl: string; httpBase: string } {
  const customWs = import.meta.env.VITE_WS_URL as string | undefined;
  const host = window.location.hostname || 'localhost';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const httpProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
  return {
    wsUrl: customWs ?? `${wsProtocol}://${host}:8000/ws/fsd`,
    httpBase: `${httpProtocol}://${host}:8000`,
  };
}

/**
 * Gère la connexion WebSocket temps réel avec le backend NEAT :
 * - Met à jour `stateRef` à 60 FPS pour un rendu Canvas/WebGL sans latence.
 * - Limite les rafraîchissements DOM React (~14 Hz) pour économiser le thread principal,
 *   sauf lors des transitions de génération ou changements de commande.
 */
export function useSimulationSocket(): UseSimulationSocketResult {
  const [uiState, setUiState] = useState<SimState | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fps, setFps] = useState(0);

  const stateRef = useRef<SimState | null>(null);
  const mapRef = useRef<MapData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const { wsUrl } = getBackendUrls();
    let reconnectTimer: number | null = null;
    let disposed = false;
    let attempt = 0;

    let framesThisSecond = 0;
    let lastFpsSample = performance.now();
    let lastUiCommit = 0;
    let lastGen = -1;
    let lastPaused: boolean | null = null;
    let lastSpeed = -1;

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        attempt = 0;
        setStatus('connected');
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const incoming = JSON.parse(event.data) as SimState;

          if (incoming.map) {
            mapRef.current = incoming.map;
            setMapData(incoming.map);
          } else if (mapRef.current) {
            incoming.map = mapRef.current;
          }

          stateRef.current = incoming;

          // Mesure de débit réelle du flux WebSocket
          framesThisSecond += 1;
          const now = performance.now();
          if (now - lastFpsSample >= 1000) {
            setFps(Math.round((framesThisSecond * 1000) / (now - lastFpsSample)));
            framesThisSecond = 0;
            lastFpsSample = now;
          }

          const stateChangedUrgently =
            incoming.generation !== lastGen ||
            incoming.paused !== lastPaused ||
            incoming.speedMultiplier !== lastSpeed;

          if (stateChangedUrgently || now - lastUiCommit >= 70) {
            lastUiCommit = now;
            lastGen = incoming.generation;
            lastPaused = incoming.paused;
            lastSpeed = incoming.speedMultiplier;
            setUiState(incoming);
          }
        } catch (err) {
          console.error('[FSD] Échec de décodage télémétrie:', err);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('disconnected');
        setFps(0);
        const delayMs = Math.min(3000, 600 * Math.pow(1.4, attempt));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      wsRef.current?.close();
    };
  }, []);

  const sendCommand = useCallback((command: SimCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(command));
      return;
    }

    // Repli REST si le socket est en cours de reconnexion
    if (command.action !== 'request_state') {
      const { httpBase } = getBackendUrls();
      void fetch(`${httpBase}/api/sim/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      }).catch(() => {});
    }
  }, []);

  return { uiState, mapData, stateRef, mapRef, status, fps, sendCommand };
}
