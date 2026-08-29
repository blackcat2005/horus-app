/**
 * RoomSync Service — polling sync_room cho Controller
 * Khớp API Docs v1.md: GET /rooms/:id/sync?since=revision (3-5s)
 */
import { syncRoom, SyncRoomData } from '../api/rooms';
import { logger } from '../utils/logger';

export type RoomSyncHandler = (data: SyncRoomData) => void;

class RoomSyncService {
  private roomId: string | null = null;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private handlers = new Set<RoomSyncHandler>();

  public start(roomId: string, initialRevision = 0): void {
    this.stop();
    this.roomId = roomId;
    this.revision = initialRevision;
    this.running = true;
    logger.info('RoomSync started', { roomId });
    this.loop();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.roomId) logger.info('RoomSync stopped', { roomId: this.roomId });
    this.roomId = null;
  }

  public subscribe(handler: RoomSyncHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public getRevision(): number {
    return this.revision;
  }

  private async loop(): Promise<void> {
    if (!this.running || !this.roomId) return;
    let nextIn = 5000;
    try {
      const data = await syncRoom(this.roomId, this.revision);
      this.revision = data.revision;
      nextIn = (data.next_sync_in ?? 5) * 1000;
      this.handlers.forEach(h => {
        try {
          h(data);
        } catch (e) {
          logger.error('RoomSync handler error', e);
        }
      });
    } catch (e) {
      logger.warn('RoomSync poll failed', e);
      nextIn = 5000;
    }
    if (this.running) {
      this.timer = setTimeout(() => this.loop(), nextIn);
    }
  }
}

export const roomSyncService = new RoomSyncService();
