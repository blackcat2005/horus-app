/**
 * ControllerScreen — demo luồng Controller theo API Docs v1
 * - Tạo phòng (POST /rooms), hiện invite_code, refresh code
 * - Poll sync_room, hiện members + trạng thái quay
 * - Gửi start/stop recording, set_camera_config
 * - Nút Preview mở WS mediasoup (mediasoupService) — hiện log sự kiện
 */
import { useEffect, useState, useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { colors, spacing, radius } from '../constants/theme';
import { logger } from '../utils/logger';
import { createRoom, refreshInviteCode, joinRoom, leaveRoom, startRecording, stopRecording, setCameraConfig, closeRoom } from '../api/rooms';
import { getDeviceId } from '../utils/device';
import { useRoomSync } from '../hooks/useRoomSync';
import { mediasoupService } from '../services/mediasoup';
import { mediasoupClientService } from '../services/mediasoupClient';
import { ApiError } from '../api/client';
import { Platform } from 'react-native';

export default function ControllerScreen() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteExpires, setInviteExpires] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const { data: syncData } = useRoomSync(roomId, !!roomId);
  const [mediaLog, setMediaLog] = useState<string[]>([]);
  const [streams, setStreams] = useState<Map<string, any>>(new Map());
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinLog, setJoinLog] = useState<string[]>([]);

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try {
      logger.info('createRoom request', { deviceId });
      const r = await createRoom({ max_members: 8 });
      setRoomId(r.room_id);
      setInvite(r.invite_code);
      setInviteExpires(r.expires_at ?? null);
      const exp = r.expires_at ? new Date(r.expires_at).toLocaleTimeString() : 'unknown';
      logger.info('createRoom success', { room_id: r.room_id, invite: r.invite_code, expires_at: r.expires_at });
      // Nếu mã đã hết hạn (reuse phòng cũ) thì báo ngay
      if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) {
        Alert.alert('Mã mời đã hết hạn', `Mã ${r.invite_code} hết lúc ${exp}. Bấm "Mã mới" để lấy mã mới (TTL 10 phút).`);
      } else {
        Alert.alert('Phòng đã tạo', `Mã mời: ${r.invite_code}\nHết hạn: ${exp} (10 phút)`);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? `[${e.code}] ${e.message}` : String(e);
      logger.error('createRoom failed', { msg, deviceId });
      Alert.alert('Lỗi tạo phòng', msg);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  const handleRefreshCode = useCallback(async () => {
    if (!roomId) return;
    try {
      logger.info('refreshInviteCode', { roomId });
      const r = await refreshInviteCode(roomId);
      setInvite(r.invite_code);
      setInviteExpires(r.expires_at);
      logger.info('refreshInviteCode success', { invite: r.invite_code, expires_at: r.expires_at });
      Alert.alert('Mã mới', `${r.invite_code}\nHết hạn: ${new Date(r.expires_at).toLocaleTimeString()}`);
    } catch (e) {
      const msg = e instanceof ApiError ? `[${e.code}] ${e.message}` : String(e);
      logger.error('refreshInviteCode failed', { msg, roomId });
      Alert.alert('Lỗi refresh mã', msg);
    }
  }, [roomId]);

  const handleStart = useCallback(async () => {
    if (!roomId) return;
    try {
      const r = await startRecording(roomId, { target: 'all', client_command_id: `cmd_${Date.now()}` });
      Alert.alert('Đã gửi start_record', `targets: ${r.targets.join(',')} rejected: ${r.rejected.length}`);
    } catch (e) {
      Alert.alert('Lỗi', e instanceof ApiError ? e.message : 'startRecording failed');
    }
  }, [roomId]);

  const handleStop = useCallback(async () => {
    if (!roomId) return;
    try {
      const r = await stopRecording(roomId, { target: 'all', client_command_id: `cmd_${Date.now()}` });
      Alert.alert('Đã gửi stop_record', `session ${r.session_id}`);
    } catch (e) {
      Alert.alert('Lỗi', e instanceof ApiError ? e.message : 'stopRecording failed');
    }
  }, [roomId]);

  const handlePreview = useCallback(async () => {
    if (!roomId) return;
    if (Platform.OS === 'web') {
      Alert.alert('Preview', 'Web cần react-native-webrtc native — hãy chạy trên iOS/Android (Expo prebuild)');
      return;
    }
    try {
      const append = (m: string) => setMediaLog(prev => [...prev.slice(-30), `${new Date().toLocaleTimeString()} ${m}`]);
      append('Đang nối mediasoup (preview-token + WS + Device.load)...');
      setIsPreviewing(true);
      // WebRTC thực tế: recvTransport + consume từng producer, auto new-producer
      const cleanup = await mediasoupClientService.startConsuming(roomId, (memberId, stream) => {
        append(`onStream member=${memberId.slice(0, 6)} kind=${stream.getVideoTracks().length ? 'video' : 'audio'}`);
        setStreams(prev => {
          const next = new Map(prev);
          next.set(memberId, stream);
          return next;
        });
      });
      append('Preview đang chạy — chờ Remote produce');
      // Lưu cleanup để nút Ngắt gọi
      (handlePreview as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    } catch (e) {
      logger.error('Preview connect failed', e);
      setIsPreviewing(false);
      Alert.alert('Preview lỗi', String(e instanceof Error ? e.message : e));
    }
  }, [roomId]);

  const handleStopPreview = useCallback(() => {
    const c = (handlePreview as unknown as { _cleanup?: () => void })._cleanup;
    try { c?.(); } catch {}
    mediasoupClientService.disconnect();
    setStreams(new Map());
    setIsPreviewing(false);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>🎛️ Controller — Phòng & Preview</Text>
      <Text style={styles.sub}>Device: {deviceId.slice(0, 12) || '...'}</Text>

      {!roomId ? (
        <>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnText}>Tạo phòng (POST /rooms)</Text>}
          </TouchableOpacity>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Join phòng có sẵn (Remote dùng mã mời)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TextInput value={joinCode} onChangeText={setJoinCode} placeholder="Nhập mã mời 6 ký tự (vd ABCD12)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={{ flex: 1, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontFamily: 'monospace' }} />
              <TouchableOpacity style={[styles.smallBtn, { justifyContent: 'center' }]} onPress={async () => {
                const code = joinCode.trim().toUpperCase(); if (!code) return Alert.alert('Thiếu mã mời'); try { logger.info('joinRoom attempt', { code, deviceId }); const r = await joinRoom({ invite_code: code, device_id: deviceId, camera_name: 'Mobile-'+deviceId.slice(0,4), grant_control: true }); setRoomId(r.room_id); setInvite(code); setJoinLog(prev=>[...prev.slice(-10), `${new Date().toLocaleTimeString()} join OK ${code} -> ${r.room_id.slice(0,8)}`]); Alert.alert('Đã join', r.room_id); } catch(e){ const codeErr = e instanceof ApiError ? e.code : 0; const msg = e instanceof ApiError ? e.message : String(e); const detail = `[${codeErr}] ${msg} | invite=${code} device=${deviceId.slice(0,8)}`; logger.error('joinRoom failed', { detail }); setJoinLog(prev=>[...prev.slice(-10), `${new Date().toLocaleTimeString()} join FAIL ${detail}`]); if(codeErr===9992) Alert.alert('Mã mời hết hạn', `${msg}\n\nMã ${code} đã hết hạn (TTL 10 phút). Bảo Controller bấm "Mã mới" trên web/app để lấy mã mới rồi thử lại.`); else Alert.alert('Join lỗi', detail); }
              }}><Text style={styles.smallText}>Join</Text></TouchableOpacity>
            </View>
            <Text style={[styles.muted,{marginTop: spacing.xs}]}>Lấy mã mời từ dashboard web http://localhost:3000 → Phòng → copy Mã mời</Text>
            {joinLog.length>0 && joinLog.map((l,i)=><Text key={i} style={[styles.muted,{fontFamily:'monospace',marginTop:2}]}>{l}</Text>)}
          </View>
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Phòng: {roomId.slice(0, 8)}</Text>
            <Text style={styles.invite}>Mã mời: {invite ?? '...'}</Text>
            {inviteExpires && <Text style={[styles.muted,{marginTop:4}]}>Hết hạn: {new Date(inviteExpires).toLocaleString()} {new Date(inviteExpires).getTime()<Date.now() ? '⚠️ Đã hết hạn — bấm Mã mới' : ''}</Text>}
            <View style={styles.row}>
              <TouchableOpacity style={styles.smallBtn} onPress={handleRefreshCode}><Text style={styles.smallText}>↻ Mã mới</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, { backgroundColor: colors.danger }]} onPress={async () => { await closeRoom(roomId); setRoomId(null); }}><Text style={styles.smallText}>Đóng phòng</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, { backgroundColor: colors.textSecondary }]} onPress={async () => { await leaveRoom(roomId); setRoomId(null); }}><Text style={styles.smallText}>Rời phòng</Text></TouchableOpacity>
            </View>
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.danger }]} onPress={handleStart}><Text style={styles.btnText}>● Start ALL</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.textSecondary }]} onPress={handleStop}><Text style={styles.btnText}>■ Stop ALL</Text></TouchableOpacity>
          </View>

          {!isPreviewing ? (
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.success }]} onPress={handlePreview}><Text style={styles.btnText}>👁️ Mở Preview mediasoup (WebRTC)</Text></TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.danger }]} onPress={handleStopPreview}><Text style={styles.btnText}>⏹ Ngắt Preview</Text></TouchableOpacity>
          )}
          {streams.size > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Streams đang xem ({streams.size})</Text>
              {[...streams.entries()].map(([mid, stream]) => (
                <View key={mid} style={{ marginTop: spacing.sm }}>
                  <Text style={styles.muted}>member {mid.slice(0, 8)} — {stream.getVideoTracks().length} video</Text>
                  {Platform.OS !== 'web' ? (
                    // @ts-ignore RTCView lazy
                    (() => { try { const { RTCView } = require('react-native-webrtc'); return <RTCView streamURL={stream.toURL()} style={{ height: 180, backgroundColor: '#000', borderRadius: 12, marginTop: 6 }} objectFit="contain" />; } catch { return <Text style={styles.muted}>RTCView lỗi</Text>; } })()
                  ) : <Text style={styles.muted}>RTCView chỉ có trên native</Text>}
                </View>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Members (sync_room rev={syncData?.revision ?? 0})</Text>
            {!syncData ? <ActivityIndicator /> : syncData.members.length === 0 ? <Text style={styles.muted}>Chưa có thành viên</Text> : syncData.members.map(m => (
              <View key={m.member_id} style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.camera_name} · {m.device_id.slice(0, 8)}</Text>
                  <Text style={styles.muted}>recording={m.recording_state} · batt={m.battery_level} · online={m.is_online}</Text>
                </View>
                <TouchableOpacity onPress={() => setCameraConfig(roomId, m.member_id, { flash_mode: 'auto', zoom_factor: 2.0, client_command_id: `cam_${Date.now()}` })}><Text style={{ color: colors.primary }}>⚡ Flash</Text></TouchableOpacity>
              </View>
            ))}
            {syncData?.joined?.length ? <Text style={styles.muted}>Joined: {syncData.joined.map(j => j.camera_name).join(', ')}</Text> : null}
            {syncData?.left?.length ? <Text style={styles.muted}>Left: {syncData.left.join(', ')}</Text> : null}
          </View>

          {mediaLog.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mediasoup log</Text>
              {mediaLog.map((l, i) => <Text key={i} style={styles.logText}>{l}</Text>)}
              <TouchableOpacity onPress={handleStopPreview}><Text style={{ color: colors.danger, marginTop: 8 }}>Ngắt WS</Text></TouchableOpacity>
            </View>
          )}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: 'monospace' },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  btnText: { color: colors.white, fontWeight: 'bold' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  cardTitle: { fontWeight: 'bold', color: colors.text, marginBottom: 6 },
  invite: { fontSize: 18, fontWeight: 'bold', color: colors.primary, letterSpacing: 2 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  smallText: { color: colors.white, fontWeight: '600', fontSize: 12 },
  actionBtn: { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  memberName: { fontWeight: '600', color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted },
  logText: { fontSize: 11, color: colors.textSecondary, fontFamily: 'monospace' },
});
