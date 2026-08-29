/**
 * useRoomSync — hook cho Controller polling sync_room
 */
import { useEffect, useState, useCallback } from 'react';
import { SyncRoomData } from '../api/rooms';
import { roomSyncService } from '../services/roomSync';

export function useRoomSync(roomId: string | null, enabled = true) {
  const [data, setData] = useState<SyncRoomData | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!roomId || !enabled) return;
    const off = roomSyncService.subscribe(d => {
      setData(d);
      setRevision(d.revision);
    });
    roomSyncService.start(roomId);
    return () => {
      off();
      roomSyncService.stop();
    };
  }, [roomId, enabled]);

  const refresh = useCallback(() => {
    if (roomId) roomSyncService.start(roomId, revision);
  }, [roomId, revision]);

  return { data, revision, refresh };
}
