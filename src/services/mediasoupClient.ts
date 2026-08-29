/**
 * MediasoupClient Service — WebRTC thực tế cho preview SFU
 * Dùng mediasoup-client + react-native-webrtc qua signaling mediasoupService.
 * Remote: getUserMedia → sendTransport → produce
 * Controller: recvTransport → consume → RTCView stream → resume
 */
import { logger } from '../utils/logger';
import { mediasoupService } from './mediasoup';

// Lazy import để web (không có react-native-webrtc) vẫn tsc được
let webrtc: any | null = null;
let mediasoupClient: any | null = null;

async function loadWebRTC(): Promise<any> {
  if (!webrtc) {
    try {
      // @ts-ignore — optional dep, installed via npm i react-native-webrtc
      webrtc = await import('react-native-webrtc');
      (webrtc as unknown as { registerGlobals: () => void }).registerGlobals?.();
    } catch (e: any) {
      const msg = 'webrtc native module not found — Expo Go không có react-native-webrtc. Chạy: npx expo prebuild && npx expo run:android (hoặc run:ios) để tạo dev-client, hoặc `eas build --profile development`. Không dùng `npx expo start` với Expo Go cho preview.';
      logger.warn('react-native-webrtc not available (need dev-client)', { err: e?.message ?? String(e) });
      throw new Error(msg);
    }
  }
  return webrtc;
}

async function loadMediasoup(): Promise<any> {
  if (!mediasoupClient) {
    // @ts-ignore — optional dep, installed via npm i mediasoup-client
    mediasoupClient = await import('mediasoup-client');
  }
  return mediasoupClient;
}

type Transport = any;
type DeviceType = any;

class MediasoupClientService {
  private device: DeviceType | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private localStream: any | null = null;
  private consumers = new Map<string, { consumer: any; stream: any }>();

  public async startProducing(roomId: string): Promise<void> {
    const wrtc = await loadWebRTC();
    const ms = await loadMediasoup();

    // 1) Nối signaling nếu chưa
    const state = mediasoupService.getState();
    if (!state.connected) {
      await mediasoupService.connect(roomId, { quality: 'low', protocol: 'webrtc' });
    }
    const rtpCaps = mediasoupService.getState().rtpCapabilities as unknown as any;
    if (!rtpCaps) throw new Error('No rtpCapabilities from welcome');

    // 2) Tạo Device
    this.device = new ms.Device();
    await this.device.load({ routerRtpCapabilities: rtpCaps });
    logger.info('mediasoup Device loaded', { canProduceVideo: this.device.canProduce('video') });

    // 3) Lấy local camera
    this.localStream = await (wrtc.mediaDevices as unknown as { getUserMedia: (c: unknown) => Promise<any> }).getUserMedia({
      audio: true,
      video: { facingMode: 'environment', width: 640, height: 480, frameRate: 15 },
    });

    // 4) Tạo send transport qua server
    const trRes = (await mediasoupService.createTransportAsync('send')) as unknown as {
      transport_id: string; ice_parameters: unknown; ice_candidates: unknown; dtls_parameters: unknown;
    };
    this.sendTransport = this.device.createSendTransport({
      id: trRes.transport_id,
      iceParameters: trRes.ice_parameters as any,
      iceCandidates: trRes.ice_candidates as any,
      dtlsParameters: trRes.dtls_parameters as any,
    });

    this.sendTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        await mediasoupService.connectTransportAsync(trRes.transport_id, dtlsParameters);
        callback();
      } catch (e) {
        errback(e as Error);
      }
    });
    this.sendTransport.on('produce', async ({ kind, rtpParameters }: any, callback: any, errback: any) => {
      try {
        const res = (await mediasoupService.produceAsync(trRes.transport_id, kind, rtpParameters)) as unknown as { producer_id: string };
        callback({ id: res.producer_id });
      } catch (e) {
        errback(e as Error);
      }
    });

    // 5) Produce
    const videoTrack = this.localStream.getVideoTracks()[0];
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (videoTrack) await this.sendTransport.produce({ track: videoTrack });
    if (audioTrack) await this.sendTransport.produce({ track: audioTrack });
    logger.info('Producing done');
  }

  public stopProducing(): void {
    try { this.localStream?.getTracks().forEach((t: any) => t.stop()); } catch {}
    try { this.sendTransport?.close(); } catch {}
    this.sendTransport = null;
    this.localStream = null;
  }

  public async startConsuming(roomId: string, onStream: (memberId: string, stream: any) => void): Promise<() => void> {
    const ms = await loadMediasoup();
    await loadWebRTC();

    const state = mediasoupService.getState();
    if (!state.connected) {
      await mediasoupService.connect(roomId, { quality: 'low', protocol: 'webrtc' });
    }
    const rtpCaps = mediasoupService.getState().rtpCapabilities as unknown as any;
    if (!this.device) {
      this.device = new ms.Device();
      await this.device.load({ routerRtpCapabilities: rtpCaps });
    }

    // Tạo recv transport
    const trRes = (await mediasoupService.createTransportAsync('recv')) as unknown as {
      transport_id: string; ice_parameters: unknown; ice_candidates: unknown; dtls_parameters: unknown;
    };
    this.recvTransport = this.device.createRecvTransport({
      id: trRes.transport_id,
      iceParameters: trRes.ice_parameters as any,
      iceCandidates: trRes.ice_candidates as any,
      dtlsParameters: trRes.dtls_parameters as any,
    });
    this.recvTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        await mediasoupService.connectTransportAsync(trRes.transport_id, dtlsParameters);
        callback();
      } catch (e) { errback(e as Error); }
    });

    // Lấy danh sách producer hiện có
    try {
      const list = (await mediasoupService.getProducersAsync()) as unknown as { producers: { member_id: string; producer_id: string; kind: string }[] };
      for (const p of list.producers ?? []) {
        await this.consumeOne(p.member_id, p.producer_id, onStream);
      }
    } catch (e) { logger.warn('getProducers failed', e); }

    // Lắng new-producer / producer-closed
    const offNew = mediasoupService.on('new-producer', async msg => {
      const m = msg as unknown as { member_id: string; producer_id: string; kind: string };
      await this.consumeOne(m.member_id, m.producer_id, onStream);
    });
    const offClosed = mediasoupService.on('producer-closed', msg => {
      const m = msg as unknown as { producer_id: string };
      const entry = [...this.consumers.entries()].find(([, v]) => v.consumer.producerId === m.producer_id);
      if (entry) { try { entry[1].consumer.close(); } catch {} this.consumers.delete(entry[0]); }
    });

    return () => { offNew(); offClosed(); try { this.recvTransport?.close(); } catch {} this.recvTransport = null; };
  }

  private async consumeOne(memberId: string, producerId: string, onStream: (memberId: string, stream: any) => void): Promise<void> {
    if (!this.device || !this.recvTransport) return;
    if ([...this.consumers.values()].some(v => v.consumer.producerId === producerId)) return;
    try {
      const res = (await mediasoupService.consumeAsync(this.recvTransport.id, producerId, this.device.rtpCapabilities)) as unknown as {
        consumer_id: string; producer_id: string; kind: string; rtp_parameters: unknown;
      };
      const consumer = await this.recvTransport.consume({
        id: res.consumer_id,
        producerId: res.producer_id,
        kind: res.kind as 'audio' | 'video',
        rtpParameters: res.rtp_parameters as any,
      });
      const stream = new (await loadWebRTC()).MediaStream();
      // @ts-ignore react-native-webrtc MediaStream addTrack
      (stream as unknown as { addTrack: (t: unknown) => void }).addTrack(consumer.track);
      this.consumers.set(consumer.id, { consumer, stream });
      onStream(memberId, stream as unknown as any);
      await mediasoupService.resumeConsumerAsync(consumer.id);
      logger.info('Consuming', { producerId, memberId });
    } catch (e) { logger.error('consumeOne failed', e); }
  }

  public getLocalStream(): any | null { return this.localStream; }
  public getConsumers(): Map<string, { consumer: any; stream: any }> { return this.consumers; }
  public disconnect(): void { this.stopProducing(); try { this.recvTransport?.close(); } catch {} this.recvTransport = null; this.consumers.clear(); mediasoupService.disconnect(); }
}

export const mediasoupClientService = new MediasoupClientService();
