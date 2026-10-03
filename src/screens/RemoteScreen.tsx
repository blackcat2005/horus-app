/**
 * Remote Screen Component
 * Màn hình chính cho thiết bị remote - chụp ảnh/quay video và stream tới controller
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  StatusBar as RNStatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter } from 'expo-router';

import { logger } from '../utils/logger';
import { wsService } from '../services/websocket';
import { cameraService } from '../services/camera';
import { streamingService } from '../services/streaming';
import { localStore } from '../services/localStore';
import { getDeviceId } from '../utils/device';
import { getDeviceInfo } from '../services/deviceInfo';
import { serverConfigService, ServerConfig, LanRoom } from '../services/serverConfig';
import { fetchLanRooms } from '../services/discovery';
import { colors, spacing, radius } from '../constants/theme';
import { ENABLE_SOCKET } from '../constants/config';
import { useDeviceSync } from '../hooks/useDeviceSync';
import { useAuthSession } from '../hooks/useAuthSession';
import { mediasoupClientService } from '../services/mediasoupClient';
import { deviceSyncService } from '../services/deviceSync';
import { joinRoom, leaveRoom } from '../api/rooms';
import { ApiError } from '../api/client';

export default function RemoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [wsConnected, setWsConnected] = useState(!ENABLE_SOCKET);
  const [streamingStats, setStreamingStats] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [roomIdForPreview, setRoomIdForPreview] = useState<string | null>(null);
  const [joinPending, setJoinPending] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [openRooms, setOpenRooms] = useState<LanRoom[] | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [joinLog, setJoinLog] = useState<string[]>([]);
  const [dbgLog, setDbgLog] = useState<string[]>([]);
  const [showDbg, setShowDbg] = useState(true);
  const [localWrtcStream, setLocalWrtcStream] = useState<any>(null);
  const [rtcKey, setRtcKey] = useState(0);
  const [RTCViewComp, setRTCViewComp] = useState<any>(null);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  const [showTopBar, setShowTopBar] = useState(true);
  useEffect(() => {
    if (isPreviewing && !RTCViewComp) {
      import('react-native-webrtc')
        .then(m => setRTCViewComp(() => (m as any).RTCView))
        .catch(() => {});
    }
  }, [isPreviewing, RTCViewComp]);
  const dbgScrollRef = useRef<ScrollView>(null);
  const dbg = useCallback((m: string) => {
    const line = `${new Date().toLocaleTimeString()} ${m}`;
    setDbgLog(prev => [...prev.slice(-40), line]);
    logger.info(line);
  }, []);
  useEffect(() => {
    dbgScrollRef.current?.scrollToEnd({ animated: true });
  }, [dbgLog]);

  const cameraRef = useRef<CameraView | null>(null);

  // Refs giữ handler mới nhất để WebSocket handler (đăng ký 1 lần) không bị stale closure
  const handleStartStreamingRef = useRef<() => void>(() => {});
  const handleStopStreamingRef = useRef<() => void>(() => {});

  // Tạo unique device ID (cố định, được lưu trong AsyncStorage)
  const deviceName = useRef(`Remote Device`);

  // Nạp cấu hình server từ AsyncStorage + lắng nghe thay đổi từ Settings tab
  useEffect(() => {
    serverConfigService.load().then(setServerConfig);
    return serverConfigService.subscribe(setServerConfig);
  }, []);

  const wsUrl = serverConfig ? serverConfigService.liveWsUrl(serverConfig) : '';
  const apiWsUrl = serverConfig ? serverConfigService.wsUrl(serverConfig) : '';

  // Nạp deviceId cố định
  useEffect(() => {
    getDeviceId().then(id => setDeviceId(id));
  }, []);

  // Polling sync_device theo API Docs v1 (3-5s) — nhận lệnh quay từ Controller
  const { session } = useAuthSession();
  const isRemote = session?.accountRole === 'remote';
  useDeviceSync(deviceId, { enabled: !!deviceId && !!session && isRemote });

  // Auto-join phòng LAN đã chọn ở màn đăng nhập — remote không cần gõ mã mời
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (!deviceId || !session || roomIdForPreview || autoJoinedRef.current) return;
    let cancelled = false;
    (async () => {
      const lanRoom = await serverConfigService.loadLanRoom();
      if (cancelled || autoJoinedRef.current || !lanRoom?.invite_code) return;
      autoJoinedRef.current = true;
      try {
        dbg(`Auto-join phòng LAN "${lanRoom.room_name || lanRoom.invite_code}"`);
        const r = await joinRoom({
          invite_code: lanRoom.invite_code,
          device_id: deviceId,
          camera_name: 'Remote-' + deviceId.slice(0, 4),
          grant_control: true,
        });
        setRoomIdForPreview(r.room_id);
        const pending = r.member_join_status === 'pending';
        setJoinPending(pending);
        if (pending) dbg('Auto-join: đang chờ Controller duyệt');
        else dbg(`Auto-join OK room=${r.room_id.slice(0, 6)}`);
      } catch (e: any) {
        autoJoinedRef.current = false;
        dbg(`Auto-join thất bại: ${String(e?.message || e)}`);
        serverConfigService.clearLanRoom();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, session, roomIdForPreview]);

  // Join phòng (dùng chung cho nút Join mã mời và danh sách phòng LAN)
  const doJoin = useCallback(
    async (code: string, roomName: string | null) => {
      if (!deviceId) return;
      const attemptJoin = async (): Promise<boolean> => {
        const r = await joinRoom({
          invite_code: code,
          device_id: deviceId,
          camera_name: 'Remote-' + deviceId.slice(0, 4),
          grant_control: true,
        });
        await serverConfigService.saveLanRoom({
          room_id: r.room_id,
          room_name: roomName,
          invite_code: code,
          auto_approve: 1,
        });
        setRoomIdForPreview(r.room_id);
        const pending = r.member_join_status === 'pending';
        setJoinPending(pending);
        return pending;
      };
      try {
        dbg(`Join room "${roomName || code}"`);
        const pending = await attemptJoin();
        if (pending) {
          dbg('Đã gửi yêu cầu join — chờ Controller duyệt');
          Alert.alert('Đã gửi yêu cầu', 'Controller cần duyệt trước khi bạn phát sóng.');
        } else {
          dbg('join OK');
          Alert.alert('Đã join', 'Đã vào phòng ' + (roomName || code));
        }
      } catch (e: any) {
        // 1010 = thiết bị đang ở phòng KHÁC → rời phòng cũ rồi join lại phòng mới
        if (String(e?.code) === '1010' && roomIdForPreview) {
          dbg('Đang ở phòng khác (1010) — rời phòng cũ rồi join lại');
          try {
            await leaveRoom(roomIdForPreview);
            setRoomIdForPreview(null);
            setJoinPending(false);
          } catch {}
          try {
            const pending = await attemptJoin();
            dbg(
              pending ? 'Đã join sau khi rời phòng cũ (chờ duyệt)' : 'Join OK sau khi rời phòng cũ',
            );
          } catch (e2: any) {
            Alert.alert('Join lỗi', String(e2?.message || e2));
          }
          return;
        }
        Alert.alert('Join lỗi', String(e?.message || e));
      }
    },
    [deviceId, dbg, roomIdForPreview],
  );

  // Tải danh sách phòng đang mở trên LAN (GET /rooms/discover) từ server đã cấu hình
  const loadOpenRooms = useCallback(async () => {
    if (!serverConfig) return;
    setRoomsLoading(true);
    try {
      const rooms = await fetchLanRooms(
        serverConfig.host,
        Number(serverConfig.port) || 3000,
        {},
        3000,
      );
      setOpenRooms(rooms ?? []);
      if (rooms && rooms.length === 0) dbg('Không có phòng nào đang mở trên LAN');
    } catch (err: any) {
      dbg('Lỗi tải phòng LAN: ' + String(err?.message || err));
      setOpenRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  }, [serverConfig, dbg]);

  // Log insets ngay khi mount để debug Samsung đè bar
  useEffect(() => {
    setTimeout(() => {
      dbg(
        `SAFE insets top=${insets.top} bottom=${insets.bottom} statusBarH=${RNStatusBar.currentHeight || 0}`,
      );
    }, 0);
  }, [insets.top, insets.bottom, dbg]);

  // Nếu màn hình bị Unmount giữa chừng khi đang phát → nhả keep-awake (tránh rò rỉ)
  useEffect(() => {
    return () => {
      try {
        deactivateKeepAwake('broadcast');
      } catch {
        /* noop */
      }
    };
  }, []);
  // Theo dõi room_status — chỉ log khi đổi in_room/room_id để đỡ spam 3-5s polling
  const lastRoomRef = useRef<string>('0');
  useEffect(() => {
    return deviceSyncService.onRoomStatusChange(s => {
      const key = `${s.in_room ? 1 : 0}_${s.room_id || ''}`;
      if (key !== lastRoomRef.current) {
        lastRoomRef.current = key;
        dbg(`room_status in_room=${s.in_room} room_id=${s.room_id?.slice(0, 8) || 'null'}`);
      }
      setRoomIdForPreview(s.in_room ? s.room_id : null);
      streamingService.setActiveRoom(s.in_room ? s.room_id : null);
      if (!s.in_room && isPreviewing) {
        dbg('leave room → disconnect mediasoup');
        mediasoupClientService.disconnect();
        setIsPreviewing(false);
      }
      if (!s.in_room) {
        setJoinPending(false);
      }
    });
  }, [isPreviewing, dbg]);

  // Bật phát sóng (produce) — như nút "Phát sóng", dùng cho cả click lẫn lệnh từ Controller
  const startBroadcast = useCallback(async () => {
    if (isPreviewing) {
      dbg('Đã đang phát sóng rồi — bỏ qua');
      return;
    }
    if (!roomIdForPreview) {
      dbg('startBroadcast: chưa ở trong phòng, bỏ qua');
      return;
    }
    try {
      dbg('startProducing begin (Controller kích hoạt)');
      await mediasoupClientService.startProducing(roomIdForPreview);
      const s = mediasoupClientService.getLocalStream();
      setLocalWrtcStream(s);
      // Giữ màn hình không tối/khoá — nếu màn hình ngủ, Android/Chrome ngừng
      // bơm camera & WebRTC → file ghi bị "đứng" đúng quãng đó.
      activateKeepAwake('broadcast');
      const vt = s?.getVideoTracks?.()[0];
      dbg(`local video enabled=${vt?.enabled} readyState=${vt?.readyState}`);
      setIsPreviewing(true);
      dbg('Producing done isPreviewing=true');
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      dbg('Producing failed: ' + msg);
      Alert.alert('Preview lỗi', msg);
    }
  }, [isPreviewing, roomIdForPreview, dbg]);

  // Dừng phát sóng — server tự finalize file MP4 (recorder) và lưu vào Videos
  const stopBroadcast = useCallback(async () => {
    dbg('Ngắt preview → server lưu broadcast');
    deactivateKeepAwake('broadcast');
    mediasoupClientService.disconnect();
    setLocalWrtcStream(null);
    setIsPreviewing(false);
    setIsFullscreenPreview(false);
  }, [dbg]);

  // Lệnh từ Controller: được duyệt / bị kick / kích hoạt & dừng GHI (điều khiển nhiều app cùng lúc)
  useEffect(() => {
    const offApproved = deviceSyncService.onCommand('join_approved', async () => {
      dbg('Controller đã duyệt — có thể phát sóng');
      setJoinPending(false);
    });
    const offLeave = deviceSyncService.onCommand('leave_room', async cmd => {
      const reason = ((cmd.payload as any)?.reason as string) ?? 'unknown';
      dbg(`leave_room (${reason}) → thoát phòng`);
      if (reason === 'denied') {
        Alert.alert('Bị từ chối', 'Controller đã từ chối yêu cầu tham gia của bạn.');
      }
      setJoinPending(false);
      setRoomIdForPreview(null);
    });
    // Controller bấm "Ghi ALL" → mọi Remote online có grant_control nhận start_record → tự phát sóng
    //   + lưu session_id từ lệnh (để gom cùng folder trên MinIO khi upload)
    const offStart = deviceSyncService.onCommand('start_record', async cmd => {
      const sid = (cmd.payload as any)?.session_id as string | undefined;
      const cfg = (cmd.payload as any)?.config as Record<string, unknown> | undefined;
      if (sid) {
        streamingService.setActiveSession(sid);
        dbg(`Controller → BẮT ĐẦU GHI session=${sid.slice(0, 8)}: tự bật Phát sóng`);
      } else {
        streamingService.setActiveSession(null);
        dbg('Controller → BẮT ĐẦU GHI (ko có session_id): tự bật Phát sóng');
      }
      // Nếu cấu hình yêu cầu record local (client side record & upload) → bấm luôn startRecording
      if (cfg?.local_record === 1) {
        void streamingService.startRecording();
      }
      await startBroadcast();
    });
    // Controller bấm "Dừng ALL" → dừng phát, server auto-finalize MP4 cho từng Remote
    //   + nếu có local recording đang chạy thì dừng + upload nó với session_id đã lưu
    const offStop = deviceSyncService.onCommand('stop_record', async cmd => {
      const sid = (cmd.payload as any)?.session_id as string | undefined;
      dbg(
        `Controller → DỪNG GHI session=${(sid || 'unknown').slice(0, 8)}: tự dừng Phát sóng (server lưu broadcast)`,
      );
      await stopBroadcast();
      // Nếu có video đang quay local thì dừng & upload nó theo session_id đã set trước đó
      if (cameraService.isVideoRecording_?.()) {
        const uri = await streamingService.stopRecording();
        if (uri) {
          streamingService.uploadRecording(uri, _p => {}).catch(e =>
            logger.error('Local upload after stop_record failed', e),
          );
        }
      }
      // Xoá session sau khi đã gửi lệnh dừng & upload (đặt timeout để luồng upload kịp đọc state)
      setTimeout(() => streamingService.setActiveSession(null), 15_000);
    });
    return () => {
      offApproved();
      offLeave();
      offStart();
      offStop();
    };
  }, [dbg, startBroadcast, stopBroadcast]);

  // Yêu cầu quyền Camera khi component mount
  useEffect(() => {
    logger.info('Requesting camera permission ', { isWeb, permission });
    if (!isWeb && (!permission || !permission.granted)) {
      requestPermission();
    }
  }, [isWeb, permission, requestPermission]);

  // Yêu cầu quyền Micro khi cần quay video
  useEffect(() => {
    logger.info('Requesting microphone permission ', { isWeb, micPermission });
    if (!isWeb && micPermission && !micPermission.granted) {
      requestMicPermission();
    }
  }, [isWeb, micPermission, requestMicPermission]);

  // Khởi tạo services và kết nối WebSocket (tự động kết nối lại khi đổi cấu hình server)
  useEffect(() => {
    if (!deviceId || !wsUrl) {
      return;
    }

    logger.info('Initializing services', {
      deviceId,
      deviceName: deviceName.current,
      wsUrl,
    });

    // Khởi tạo services
    const info = getDeviceInfo();
    streamingService.initialize(deviceId, {
      deviceModel: info.model,
      cameraName: 'Remote-' + deviceId.slice(0, 4),
    });
    localStore.initialize();

    if (!ENABLE_SOCKET) {
      // Socket tạm tắt — không kết nối, không đăng ký handler
      return;
    }

    wsService.initialize(wsUrl, deviceId, deviceName.current, 'remote');

    // Lắng nghe kết nối WebSocket
    const unsubscribeConnection = wsService.onConnectionStateChange(connected => {
      logger.info('WebSocket connection state changed', { connected });
      setWsConnected(connected);
    });

    // Lắng nghe tin nhắn STREAM_START từ controller
    const unsubscribeStreamStart = wsService.on('STREAM_START', message => {
      logger.info('Received STREAM_START command', message);
      handleStartStreamingRef.current();
    });

    // Lắng nghe tin nhắn STREAM_END từ controller
    const unsubscribeStreamEnd = wsService.on('STREAM_END', message => {
      logger.info('Received STREAM_END command', message);
      handleStopStreamingRef.current();
    });

    return () => {
      unsubscribeConnection();
      unsubscribeStreamStart();
      unsubscribeStreamEnd();
      wsService.disconnect();
      streamingService.reset();
    };
  }, [wsUrl, deviceId]);

  // Update streaming stats
  useEffect(() => {
    if (isStreaming) {
      const interval = setInterval(() => {
        setStreamingStats(streamingService.getStreamingStats());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isStreaming]);

  /**
   * Xử lý chụp ảnh + lưu local (không upload lên server)
   */
  const handleTakePicture = useCallback(async () => {
    if (isSaving) return;
    const photo = await cameraService.takePicture();

    if (!photo) {
      Alert.alert('Lỗi', 'Không thể chụp ảnh');
      return;
    }

    setPhotoUri(photo.uri);
    setIsSaving(true);

    try {
      const saved = await localStore.saveCapturedMedia(photo.uri, 'photo');
      if (saved) {
        Alert.alert('Đã lưu', `Ảnh đã lưu vào bộ nhớ: ${saved.fileName}`);
      } else {
        Alert.alert('Lỗi', 'Ảnh đã chụp nhưng lưu vào bộ nhớ thất bại');
      }
    } finally {
      setIsSaving(false);
    }
  }, [isSaving]);

  /**
   * Xử lý bắt đầu streaming
   */
  const handleStartStreaming = useCallback(() => {
    if (!isCameraReady) {
      Alert.alert('Lỗi', 'Camera chưa sẵn sàng');
      return;
    }

    if (!wsConnected) {
      Alert.alert('Lỗi', 'WebSocket chưa kết nối');
      return;
    }

    logger.info('Starting streaming');
    streamingService.startStreaming(5, 0.8);
    setIsStreaming(true);
  }, [isCameraReady, wsConnected]);

  /**
   * Xử lý dừng streaming
   */
  const handleStopStreaming = useCallback(() => {
    logger.info('Stopping streaming');
    streamingService.stopStreaming();
    setIsStreaming(false);
  }, []);

  // Cập nhật refs với handler mới nhất mỗi lần render (để WS handler không bị stale closure)
  useEffect(() => {
    handleStartStreamingRef.current = handleStartStreaming;
    handleStopStreamingRef.current = handleStopStreaming;
  });

  // UI cho web platform (không hỗ trợ)
  if (isWeb) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Web không hỗ trợ Native Camera trong app này.</Text>
        <Text style={styles.subText}>
          Vui lòng chạy trên thiết bị thật hoặc Simulator iOS/Android.
        </Text>
      </View>
    );
  }

  // UI khi chưa kiểm tra quyền
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.infoText}>Đang kiểm tra quyền camera...</Text>
      </View>
    );
  }

  // UI khi không được cấp quyền camera
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Ứng dụng chưa được cấp quyền truy cập Camera.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Khi preview thì unmount CameraView để WebRTC chiếm camera duy nhất, tránh đứng hình do 2 consumer */}
      {!isPreviewing ? (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          mode="video"
          onCameraReady={() => {
            logger.info('Camera is ready (onCameraReady fired)', {
              micStatus: micPermission?.status ?? 'unknown',
              micGranted: micPermission?.granted ?? false,
            });
            setIsCameraReady(true);
            cameraService.setCameraRef(cameraRef.current);
            cameraService.setReady(true);
          }}
          onMountError={(error: any) => {
            logger.error('Camera mount error (onMountError)', error?.nativeEvent ?? error);
          }}
        />
      ) : RTCViewComp && localWrtcStream ? (
        // @ts-ignore
        <RTCViewComp
          key={rtcKey}
          streamURL={localWrtcStream.toURL()}
          style={[styles.camera, isFullscreenPreview && styles.cameraFullscreen]}
          objectFit={isFullscreenPreview ? 'contain' : 'cover'}
          mirror={mediasoupClientService.getFacingMode() === 'user'}
        />
      ) : (
        <View
          style={[
            styles.camera,
            { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
          ]}>
          <Text style={{ color: '#fff' }}>Đang mở camera WebRTC...</Text>
        </View>
      )}

      {showTopBar ? (
        <View style={[styles.topBar, { top: insets.top, paddingTop: spacing.md }]}>
          <View style={styles.topBarRow}>
            <View style={styles.topBarInfo}>
              <Text style={styles.topBarTitle}>📷 Remote</Text>
              <Text style={styles.topBarDevice} numberOfLines={1}>
                {deviceId ? deviceId.slice(0, 12) : '...'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.hideButton}
              onPress={() => setShowTopBar(v => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.hideButtonText}>{showTopBar ? '🙈 Ẩn' : '👁️ Hiện'}</Text>
            </TouchableOpacity>
          </View>

          {/* Status chips */}
          <View style={styles.statusRow}>
            {!ENABLE_SOCKET ? (
              <View style={[styles.chip, styles.buttonDisabled]}>
                <View style={[styles.chipDot, styles.dotDanger]} />
                <Text style={styles.chipText}>Socket tạm tắt</Text>
              </View>
            ) : (
              <View style={[styles.chip, wsConnected ? styles.chipSuccess : styles.chipDanger]}>
                <View
                  style={[styles.chipDot, wsConnected ? styles.dotSuccess : styles.dotDanger]}
                />
                <Text style={styles.chipText}>{wsConnected ? 'Đã kết nối' : 'Chưa kết nối'}</Text>
              </View>
            )}
            <View style={[styles.chip, isCameraReady ? styles.chipSuccess : styles.chipDanger]}>
              <View
                style={[styles.chipDot, isCameraReady ? styles.dotSuccess : styles.dotDanger]}
              />
              <Text style={styles.chipText}>
                {isCameraReady ? 'Camera sẵn sàng' : 'Đang mở camera'}
              </Text>
            </View>
          </View>

          {isPreviewing && (
            <View
              style={[
                styles.alertBox,
                {
                  backgroundColor: 'rgba(16,185,129,0.28)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                },
              ]}>
              <Text style={styles.alertTitle}>
                📡 Đang phát{' '}
                {mediasoupClientService.getFacingMode() === 'user' ? 'cam trước' : 'cam sau'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#0f172a',
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                  }}
                  onPress={() => setIsFullscreenPreview(v => !v)}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    {isFullscreenPreview ? '🗗 Thu nhỏ' : '⛶ Phóng to'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    backgroundColor: '#0f172a',
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 8,
                  }}
                  onPress={async () => {
                    try {
                      const m = await mediasoupClientService.switchCamera();
                      const s = mediasoupClientService.getLocalStream();
                      setLocalWrtcStream(null);
                      setTimeout(() => {
                        setLocalWrtcStream(s);
                        setRtcKey(k => k + 1);
                      }, 50);
                      dbg('Đổi cam → ' + m);
                    } catch (e: any) {
                      dbg('Đổi cam lỗi ' + String(e.message || e));
                    }
                  }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>🔄 Đổi cam</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {isStreaming && streamingStats && (
            <View style={[styles.alertBox, styles.alertStreaming]}>
              <Text style={styles.alertTitle}>
                📹 Đang stream · {streamingStats.currentFPS?.toFixed(1) || 0} FPS
              </Text>
              <Text style={styles.alertSub}>Buffer: {streamingStats.bufferedFrames} frames</Text>
            </View>
          )}

          {isSaving && (
            <View style={[styles.alertBox, styles.alertSaving]}>
              <Text style={styles.alertTitle}>💾 Đang lưu vào bộ nhớ...</Text>
            </View>
          )}
          {roomIdForPreview ? (
            <View
              style={[
                styles.alertBox,
                {
                  backgroundColor: joinPending
                    ? 'rgba(245,158,11,0.25)'
                    : isPreviewing
                      ? 'rgba(16,185,129,0.28)'
                      : 'rgba(148,163,184,0.25)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                },
              ]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>
                  {joinPending
                    ? '⏳ Chờ Controller duyệt'
                    : isPreviewing
                      ? '📡 Đang phát'
                      : '📡 Đã join'}{' '}
                  · {roomIdForPreview.slice(0, 6)}
                </Text>
                <Text style={styles.alertSub}>
                  {joinPending
                    ? 'Yêu cầu của bạn đang chờ duyệt — chưa thể phát.'
                    : isPreviewing
                      ? 'Đang phát live — bấm Rời phòng hoặc Dừng phát'
                      : 'Sẵn sàng phát'}
                </Text>
              </View>
              <TouchableOpacity
                style={{
                  backgroundColor: 'rgba(239,68,68,0.9)',
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  marginLeft: 8,
                }}
                onPress={async () => {
                  try {
                    if (isPreviewing) {
                      mediasoupClientService.disconnect();
                      setLocalWrtcStream(null);
                      setIsPreviewing(false);
                      setIsFullscreenPreview(false);
                    }
                    await leaveRoom(roomIdForPreview);
                    setRoomIdForPreview(null);
                    setJoinPending(false);
                    dbg('Đã rời phòng');
                  } catch (e: any) {
                    Alert.alert('Lỗi rời phòng', String(e.message || e));
                  }
                }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Rời phòng</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.alertBox, { backgroundColor: 'rgba(37,99,235,0.18)' }]}>
              <Text style={styles.alertTitle}>🔑 Nhập mã mời</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TextInput
                  value={inviteInput}
                  onChangeText={t => setInviteInput(t.toUpperCase())}
                  placeholder="ABCD12"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  autoCapitalize="characters"
                  maxLength={12}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    color: '#fff',
                    fontFamily: 'monospace',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.3)',
                  }}
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: deviceId ? '#10b981' : '#64748b',
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 8,
                  }}
                  disabled={!deviceId}
                  onPress={async () => {
                    const code = inviteInput.trim();
                    if (!code) return Alert.alert('Thiếu mã mời');
                    doJoin(code, `Mã ${code}`);
                  }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Join</Text>
                </TouchableOpacity>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(255,255,255,0.15)',
                  paddingTop: 10,
                }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                  🏠 Phòng đang mở trên LAN
                </Text>
                <TouchableOpacity
                  style={{
                    backgroundColor: 'rgba(148,163,184,0.3)',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 8,
                  }}
                  onPress={loadOpenRooms}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    {roomsLoading ? '⏳ Đang quét...' : '🔄 Quét lại'}
                  </Text>
                </TouchableOpacity>
              </View>
              {openRooms && (
                <View style={{ marginTop: 8 }}>
                  {openRooms.length === 0 ? (
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
                      Không có phòng nào đang mở trên LAN.
                    </Text>
                  ) : (
                    openRooms.slice(0, 6).map(r => (
                      <View
                        key={r.invite_code}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 6,
                          borderBottomWidth: 1,
                          borderBottomColor: 'rgba(255,255,255,0.08)',
                        }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                            {r.room_name || 'Phòng không tên'}
                          </Text>
                          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                            {r.member_count ?? 0} thành viên{r.auto_approve ? ' • vào tự do' : ''} ·{' '}
                            <Text style={{ fontFamily: 'monospace' }}>{r.invite_code}</Text>
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={{
                            backgroundColor: '#10b981',
                            paddingHorizontal: 14,
                            paddingVertical: 6,
                            borderRadius: 8,
                            marginLeft: 8,
                          }}
                          disabled={!deviceId}
                          onPress={() => doJoin(r.invite_code, r.room_name)}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                            Vào
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.showTopBarFab, { top: insets.top + 8 }]}
          onPress={() => setShowTopBar(true)}>
          <Text style={styles.showTopBarText}>👁️ Hiện</Text>
        </TouchableOpacity>
      )}

      {/* Debug overlay — dời xuống đáy để không đè ô Nhập mã mời */}
      {showDbg && (
        <View style={styles.debugBox}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>
              🐛 Debug ({dbgLog.length}) — {deviceId.slice(0, 12)} | room{' '}
              {roomIdForPreview?.slice(0, 8) || 'none'} | {isPreviewing ? 'Đang phát' : 'Chưa phát'}
            </Text>
            <TouchableOpacity onPress={() => setDbgLog([])}>
              <Text style={styles.debugClear}>Xóa</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDbg(false)}>
              <Text style={styles.debugClear}>Ẩn</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            ref={dbgScrollRef}
            style={styles.debugScroll}
            contentContainerStyle={{ padding: 6 }}
            onContentSizeChange={() => dbgScrollRef.current?.scrollToEnd({ animated: true })}>
            {dbgLog.length === 0 ? (
              <Text style={styles.debugText}>Chưa có log — bấm Join rồi Phát preview</Text>
            ) : (
              dbgLog.map((l, i) => (
                <Text key={i} style={styles.debugText}>
                  {l}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      )}
      {!showDbg && (
        <TouchableOpacity style={styles.debugFab} onPress={() => setShowDbg(true)}>
          <Text style={styles.debugFabText}>🐛 Hiện Debug</Text>
        </TouchableOpacity>
      )}

      {/* Footer — trong Tabs bottom 0 là sát tabBar, không dùng insets để không tạo dải đen */}
      <View style={[styles.footer, { bottom: 0, paddingBottom: spacing.md }]}>
        {roomIdForPreview && Platform.OS !== 'web' && !joinPending && (
          <TouchableOpacity
            style={[
              styles.footerButton,
              isPreviewing
                ? { backgroundColor: colors.danger }
                : { backgroundColor: colors.success },
              { flex: 1, maxWidth: 320 },
            ]}
            onPress={async () => {
              dbg(
                `Phát preview pressed isPreviewing=${isPreviewing} room=${roomIdForPreview?.slice(0, 8)}`,
              );
              if (isPreviewing) {
                await stopBroadcast();
              } else {
                await startBroadcast();
              }
            }}>
            <Text style={styles.footerButtonIcon}>{isPreviewing ? '⏹️' : '📡'}</Text>
            <Text style={styles.footerButtonText}>{isPreviewing ? 'Dừng phát' : 'Phát sóng'}</Text>
          </TouchableOpacity>
        )}
        {roomIdForPreview && joinPending && (
          <View style={[styles.footerButton, { backgroundColor: '#b45309', maxWidth: 320 }]}>
            <Text style={styles.footerButtonIcon}>⏳</Text>
            <Text style={styles.footerButtonText}>Chờ Controller duyệt</Text>
          </View>
        )}
        {!roomIdForPreview && (
          <View style={[styles.footerButton, { backgroundColor: '#64748b', maxWidth: 320 }]}>
            <Text style={styles.footerButtonText}>Chưa join phòng</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    backgroundColor: colors.background,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cameraFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    zIndex: 20,
    elevation: 20,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  topBarTitle: { color: colors.white, fontSize: 14, fontWeight: '800' },
  topBarDevice: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    marginTop: 1,
    fontFamily: 'monospace',
  },
  hideButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.round,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  hideButtonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  showTopBarFab: {
    position: 'absolute',
    top: 0,
    right: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.round,
    zIndex: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  showTopBarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: radius.round,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButtonText: { fontSize: 18 },
  statusRow: { flexDirection: 'row', marginTop: spacing.sm, gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.round,
  },
  chipSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  chipDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  buttonDisabled: {
    backgroundColor: colors.border,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  dotSuccess: {
    backgroundColor: colors.success,
  },
  dotDanger: {
    backgroundColor: colors.danger,
  },
  chipText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  alertBox: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md },
  alertStreaming: {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
  },
  alertRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  alertSaving: {
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
  },
  alertTitle: { color: colors.white, fontSize: 11, fontWeight: '700' },
  alertSub: { color: 'rgba(255,255,255,0.7)', fontSize: 9, marginTop: 1 },
  photoPreviewContainer: {
    position: 'absolute',
    top: spacing.xl + 24,
    right: spacing.lg,
    zIndex: 10,
  },
  photoThumb: {
    width: 80,
    height: 120,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.white,
  },
  photoPreviewClose: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: colors.danger,
    color: colors.white,
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 13,
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    backgroundColor: colors.overlay,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    zIndex: 20,
    elevation: 20,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    maxWidth: 300,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  footerPhoto: {
    backgroundColor: colors.primary,
  },
  footerRecord: {
    backgroundColor: colors.danger,
  },
  footerStop: {
    backgroundColor: colors.warning,
  },
  footerDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.7,
  },
  footerButtonIcon: {
    color: colors.white,
    fontSize: 16,
    marginRight: spacing.sm,
  },
  footerButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: 'bold',
  },
  debugBox: {
    position: 'absolute',
    bottom: 80,
    left: spacing.md,
    right: spacing.md,
    maxHeight: 140,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: radius.md,
    padding: spacing.sm,
    zIndex: 15,
    elevation: 15,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  debugTitle: {
    color: '#a5f3fc',
    fontSize: 10,
    fontWeight: '700',
    flex: 1,
  },
  debugClear: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  debugScroll: {
    maxHeight: 140,
  },
  debugText: {
    color: '#e2e8f0',
    fontSize: 9,
    fontFamily: 'monospace',
    lineHeight: 12,
  },
  debugFab: {
    position: 'absolute',
    bottom: 80,
    right: spacing.md,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: radius.round,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    zIndex: 5,
  },
  debugFabText: {
    color: '#a5f3fc',
    fontSize: 10,
    fontWeight: '700',
  },
  infoText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    color: colors.text,
  },
  subText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    textAlign: 'center',
  },
});
