/**
 * Mediasoup Signaling Service — preview trực tiếp SFU
 * Khớp API Docs v1.md: POST /rooms/:id/preview-token → WS GET /rooms/:id/media
 * Flow: welcome → create-transport → connect-transport → produce (remote) / consume (controller)
 * Lưu ý: Đây là lớp báo hiệu. RTP thực tế cần react-native-webrtc + mediasoup-client.
 * Service này xử lý phần WebSocket JSON, để UI có thể mock hoặc gắn SDK sau.
 */
import { logger } from '../utils/logger';
import { authStore } from './authStore';
import { serverConfigService, wsUrl } from './serverConfig';
import { getPreviewToken } from '../api/rooms';

export type MediaRole = 'controller' | 'remote';

export interface MediaState {
  connected: boolean;
  role: MediaRole | null;
  participantId: string | null;
  rtpCapabilities: unknown | null;
}

type MessageHandler = (msg: Record<string, unknown>) => void;

class MediasoupService {
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private state: MediaState = { connected: false, role: null, participantId: null, rtpCapabilities: null };
  private handlers = new Map<string, Set<MessageHandler>>();
  private previewToken: string | null = null;

  public getState(): MediaState {
    return { ...this.state };
  }

  public on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, msg: Record<string, unknown>): void {
    this.handlers.get(type)?.forEach(h => {
      try {
        h(msg);
      } catch (e) {
        logger.error('Mediasoup handler error', e);
      }
    });
    // wildcard
    this.handlers.get('*')?.forEach(h => {
      try {
        h({ _type: type, ...msg });
      } catch {}
    });
  }

  /** Lấy preview_token + mở WS signaling (auth Bearer). */
  public async connect(roomId: string, opts: { quality: 'low' | 'medium'; protocol: 'hls' | 'webrtc' }): Promise<void> {
    this.disconnect();
    this.roomId = roomId;

    const preview = await getPreviewToken(roomId, opts);
    this.previewToken = preview.preview_token;
    logger.info('Preview token obtained', { roomId });

    const config = await serverConfigService.load();
    // signaling_url là "/it4788/api/v1/rooms/:id/media" — ghép thành ws(s)://host + path
    const signalingUrl = `${wsUrl(config)}${preview.signaling_url}`;

    const session = await authStore.load();
    if (!session?.accessToken) throw new Error('No access token for mediasoup WS');

    logger.info('Connecting mediasoup WS', { signalingUrl });

    // Server chỉ đọc Authorization từ handshake; RN WebSocket nhận headers qua tham số thứ 3
    // @ts-ignore — kiểu DOM WebSocket không có tham số options
    this.ws = new WebSocket(signalingUrl, undefined, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    } as unknown as string[]);

    this.ws.onopen = () => {
      logger.info('Mediasoup WS open');
      // Với một số build, gửi auth message ngay sau open nếu header không tới server
      // (server sẽ kiểm preHandler authenticate – nếu fail sẽ trả error + close)
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>;
        const type = String(msg.type ?? 'unknown');
        logger.debug('Mediasoup WS message', { type });
        // resolve pending request nếu có request_id
        const reqId = msg.request_id as string | undefined;
        if (reqId && this.pending.has(reqId)) {
          const p = this.pending.get(reqId)!;
          clearTimeout(p.timer);
          this.pending.delete(reqId);
          if (type === 'error') p.reject(new Error(String(msg.message ?? 'mediasoup error')));
          else p.resolve(msg);
        }
        if (type === 'welcome') {
          this.state = {
            connected: true,
            role: msg.role as MediaRole,
            participantId: msg.participant_id as string,
            rtpCapabilities: msg.rtp_capabilities ?? null,
          };
        }
        this.emit(type, msg);
      } catch (e) {
        logger.error('Failed to parse mediasoup WS message', e);
      }
    };

    this.ws.onclose = () => {
      logger.info('Mediasoup WS closed');
      this.state = { connected: false, role: null, participantId: null, rtpCapabilities: null };
      this.emit('close', {});
    };

    this.ws.onerror = (e: unknown) => {
      logger.error('Mediasoup WS error', e);
      this.emit('error', { error: e } as unknown as Record<string, unknown>);
    };

    // Chờ welcome hoặc error trong 10s
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mediasoup welcome timeout')), 10000);
      const offWelcome = this.on('welcome', () => {
        clearTimeout(timeout);
        offWelcome();
        offError();
        resolve();
      });
      const offError = this.on('error', msg => {
        clearTimeout(timeout);
        offWelcome();
        offError();
        reject(new Error(String((msg as Record<string, unknown>).message ?? 'Mediasoup error')));
      });
      const offClose = this.on('close', () => {
        clearTimeout(timeout);
        offWelcome();
        offError();
        offClose();
        reject(new Error('WS closed before welcome'));
      });
    });
  }

  // ── Helpers gửi JSON có request_id ──
  private reqId = 0;
  private pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private send(payload: Record<string, unknown>): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Mediasoup WS not open');
    }
    const reqId = `req_${++this.reqId}`;
    const withId = { request_id: reqId, ...payload };
    this.ws.send(JSON.stringify(withId));
    logger.debug('Mediasoup WS send', { type: payload.type, request_id: reqId });
    return reqId;
  }

  public sendRequest(payload: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
    const reqId = this.send(payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`mediasoup request timeout: ${payload.type}`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
    });
  }

  // fire-and-forget (giữ API cũ)
  public createTransport(direction: 'send' | 'recv'): void {
    this.send({ type: 'create-transport', direction });
  }

  public connectTransport(transportId: string, dtlsParameters: unknown): void {
    this.send({ type: 'connect-transport', transport_id: transportId, dtls_parameters: dtlsParameters });
  }

  public produce(transportId: string, kind: 'audio' | 'video', rtpParameters: unknown): void {
    this.send({ type: 'produce', transport_id: transportId, kind, rtp_parameters: rtpParameters });
  }

  public consume(transportId: string, producerId: string, rtpCapabilities: unknown): void {
    this.send({ type: 'consume', transport_id: transportId, producer_id: producerId, rtp_capabilities: rtpCapabilities });
  }

  public resumeConsumer(consumerId: string): void {
    this.send({ type: 'resume-consumer', consumer_id: consumerId });
  }

  public getProducers(): void {
    this.send({ type: 'get-producers' });
  }

  // promise-based helpers cho mediasoup-client
  public createTransportAsync(direction: 'send' | 'recv'): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'create-transport', direction });
  }
  public connectTransportAsync(transportId: string, dtlsParameters: unknown): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'connect-transport', transport_id: transportId, dtls_parameters: dtlsParameters });
  }
  public produceAsync(transportId: string, kind: 'audio' | 'video', rtpParameters: unknown): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'produce', transport_id: transportId, kind, rtp_parameters: rtpParameters });
  }
  public consumeAsync(transportId: string, producerId: string, rtpCapabilities: unknown): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'consume', transport_id: transportId, producer_id: producerId, rtp_capabilities: rtpCapabilities });
  }
  public resumeConsumerAsync(consumerId: string): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'resume-consumer', consumer_id: consumerId });
  }
  public getProducersAsync(): Promise<Record<string, unknown>> {
    return this.sendRequest({ type: 'get-producers' });
  }

  /** WS còn mở thật không (state.connected có thể cũ nếu socket đã chết ngầm). */
  public isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.state = { connected: false, role: null, participantId: null, rtpCapabilities: null };
    this.roomId = null;
    this.previewToken = null;
  }
}

export const mediasoupService = new MediasoupService();
