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
  View,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { logger } from '../utils/logger';
import { wsService } from '../services/websocket';
import { cameraService, CameraMode } from '../services/camera';
import { streamingService } from '../services/streaming';
import { localStore } from '../services/localStore';
import { getDeviceId } from '../utils/device';
import { serverConfigService, ServerConfig } from '../services/serverConfig';
import { colors, spacing, radius } from '../constants/theme';

export default function RemoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [cameraMode, setCameraMode] = useState<CameraMode>('picture');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [streamingStats, setStreamingStats] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);

  const cameraRef = useRef<CameraView | null>(null);

  // Refs giữ handler mới nhất để WebSocket handler (đăng ký 1 lần) không bị stale closure
  const handleStartStreamingRef = useRef<() => void>(() => {});
  const handleStopStreamingRef = useRef<() => void>(() => {});
  const handleStartRecordingRef = useRef<() => void>(() => {});
  const handleStopRecordingRef = useRef<() => void>(() => {});

  // Tạo unique device ID (cố định, được lưu trong AsyncStorage)
  const deviceName = useRef(`Remote Device`);

  // Nạp cấu hình server từ AsyncStorage + lắng nghe thay đổi từ Settings tab
  useEffect(() => {
    serverConfigService.load().then(setServerConfig);
    return serverConfigService.subscribe(setServerConfig);
  }, []);

  const wsUrl = serverConfig ? serverConfigService.wsUrl(serverConfig) : '';

  // Nạp deviceId cố định
  useEffect(() => {
    getDeviceId().then(id => setDeviceId(id));
  }, []);

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
    streamingService.initialize(deviceId);
    localStore.initialize();
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

    // Lắng nghe tin nhắn RECORD_START từ controller -> quay video thật
    const unsubscribeRecordStart = wsService.on('RECORD_START', message => {
      logger.info('Received RECORD_START command', message);
      handleStartRecordingRef.current();
    });

    // Lắng nghe tin nhắn RECORD_END từ controller -> dừng quay + upload
    const unsubscribeRecordEnd = wsService.on('RECORD_END', message => {
      logger.info('Received RECORD_END command', message);
      handleStopRecordingRef.current();
    });

    return () => {
      unsubscribeConnection();
      unsubscribeStreamStart();
      unsubscribeStreamEnd();
      unsubscribeRecordStart();
      unsubscribeRecordEnd();
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

  /**
   * Xử lý bắt đầu quay video thật
   * Chuyển camera sang chế độ video rồi mới record (expo-camera bắt buộc mode="video")
   */
  const handleStartRecording = useCallback(async () => {
    if (isSaving) return;

    if (!isCameraReady) {
      Alert.alert('Lỗi', 'Camera chưa sẵn sàng');
      return;
    }

    if (isRecording || cameraService.isVideoRecording_()) {
      return;
    }

    logger.info('Starting video recording (handleStartRecording)', {
      cameraMode,
      isCameraReady,
      cameraRefExists: cameraRef.current != null,
      cameraServiceReady: cameraService.isReady_(),
      micStatus: micPermission?.status ?? 'unknown',
      micGranted: micPermission?.granted ?? false,
    });

    // Chuyển camera sang chế độ 'video'
    setCameraMode('video');

    // QUAN TRỌNG: iOS KHÔNG re-fire onCameraReady khi đổi mode (native chỉ reconfigure session).
    // Không thể chờ onCameraReady -> phải gọi recordAsync trực tiếp sau khi native cấu hình xong.
    // Chờ 1 chút cho native áp dụng mode="video" rồi gọi record; nếu session chưa sẵn sàng
    // thì startVideoRecording sẽ tự retry bên trong camera service.
    await new Promise(resolve => setTimeout(resolve, 500));

    const started = await streamingService.startRecording();
    logger.info('streamingService.startRecording result', { started, cameraMode });

    if (started) {
      setIsRecording(true);
    } else {
      setCameraMode('picture');
      Alert.alert('Lỗi', 'Không thể bắt đầu quay video');
    }
  }, [isCameraReady, isRecording, isSaving, cameraMode, micPermission]);

  /**
   * Xử lý dừng quay video: dừng hẳn NGAY LẬP TỨC, lưu file vào bộ nhớ local
   */
  const handleStopRecording = useCallback(async () => {
    logger.info('Stopping video recording');

    // Dừng camera ngay lập tức
    const uri = await streamingService.stopRecording();

    // Trả camera về chế độ ảnh + thoát trạng thái đang quay ngay
    setIsRecording(false);
    setCameraMode('picture');

    if (!uri) {
      Alert.alert('Lỗi', 'Không lấy được file video');
      return;
    }

    // Lưu file vào bộ nhớ local (không upload lên server)
    setIsSaving(true);
    try {
      const saved = await localStore.saveCapturedMedia(uri, 'video');
      if (saved) {
        Alert.alert('Đã lưu', `Video đã lưu vào bộ nhớ: ${saved.fileName}`);
      } else {
        Alert.alert('Lỗi', 'Video đã quay nhưng lưu vào bộ nhớ thất bại');
      }
    } catch (error) {
      logger.error('Failed to save video locally', error);
      Alert.alert('Lỗi', 'Video đã quay nhưng lưu vào bộ nhớ thất bại');
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Cập nhật refs với handler mới nhất mỗi lần render (để WS handler không bị stale closure)
  useEffect(() => {
    handleStartStreamingRef.current = handleStartStreaming;
    handleStopStreamingRef.current = handleStopStreaming;
    handleStartRecordingRef.current = handleStartRecording;
    handleStopRecordingRef.current = handleStopRecording;
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
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode={cameraMode}
        onCameraReady={() => {
          logger.info('Camera is ready (onCameraReady fired)', {
            cameraMode,
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

      {/* Top Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.topBarRow}>
          <View style={styles.topBarInfo}>
            <Text style={styles.topBarTitle}>📷 Remote Camera</Text>
            <Text style={styles.topBarDevice} numberOfLines={1}>
              {deviceId ? `ID: ${deviceId}` : 'Đang lấy device ID...'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => router.push('/settings')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* Status chips */}
        <View style={styles.statusRow}>
          <View style={[styles.chip, wsConnected ? styles.chipSuccess : styles.chipDanger]}>
            <View style={[styles.chipDot, wsConnected ? styles.dotSuccess : styles.dotDanger]} />
            <Text style={styles.chipText}>{wsConnected ? 'Đã kết nối' : 'Chưa kết nối'}</Text>
          </View>
          <View style={[styles.chip, isCameraReady ? styles.chipSuccess : styles.chipDanger]}>
            <View style={[styles.chipDot, isCameraReady ? styles.dotSuccess : styles.dotDanger]} />
            <Text style={styles.chipText}>
              {isCameraReady ? 'Camera sẵn sàng' : 'Đang mở camera'}
            </Text>
          </View>
        </View>

        {isStreaming && streamingStats && (
          <View style={[styles.alertBox, styles.alertStreaming]}>
            <Text style={styles.alertTitle}>
              📹 Đang stream · {streamingStats.currentFPS?.toFixed(1) || 0} FPS
            </Text>
            <Text style={styles.alertSub}>Buffer: {streamingStats.bufferedFrames} frames</Text>
          </View>
        )}

        {isRecording && (
          <View style={[styles.alertBox, styles.alertRecording]}>
            <Text style={styles.alertTitle}>🔴 Đang quay video...</Text>
            <Text style={styles.alertSub}>Video sẽ được lưu vào bộ nhớ khi dừng</Text>
          </View>
        )}

        {isSaving && (
          <View style={[styles.alertBox, styles.alertSaving]}>
            <Text style={styles.alertTitle}>💾 Đang lưu vào bộ nhớ...</Text>
          </View>
        )}
      </View>

      {/* Preview ảnh vừa chụp - thumbnail nhỏ ở góc, bấm vào để đóng */}
      {photoUri && (
        <TouchableOpacity style={styles.photoPreviewContainer} onPress={() => setPhotoUri(null)}>
          <Image source={{ uri: photoUri }} style={styles.photoThumb} />
          <Text style={styles.photoPreviewClose}>✕</Text>
        </TouchableOpacity>
      )}

      {/* Footer Controls */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        <TouchableOpacity
          style={[styles.footerButton, styles.footerPhoto, isSaving && styles.footerDisabled]}
          onPress={handleTakePicture}
          disabled={!isCameraReady || isSaving}>
          <Text style={styles.footerButtonIcon}>📸</Text>
          <Text style={styles.footerButtonText}>Chụp ảnh</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.footerButton,
            isRecording ? styles.footerStop : styles.footerRecord,
            isSaving && styles.footerDisabled,
          ]}
          onPress={isRecording ? handleStopRecording : handleStartRecording}
          disabled={!isCameraReady || isSaving}>
          <Text style={styles.footerButtonIcon}>{isRecording ? '⏹' : '🔴'}</Text>
          <Text style={styles.footerButtonText}>
            {isSaving ? 'Đang lưu...' : isRecording ? 'Dừng quay' : 'Quay video'}
          </Text>
        </TouchableOpacity>
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.overlay,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
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
  topBarTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: 'bold',
  },
  topBarDevice: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: radius.round,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButtonText: {
    fontSize: 18,
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.round,
  },
  chipSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  chipDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
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
  chipText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  alertBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  alertStreaming: {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
  },
  alertRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  alertSaving: {
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
  },
  alertTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertSub: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    marginTop: 2,
  },
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
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    maxWidth: 220,
    paddingVertical: spacing.md,
    borderRadius: radius.round,
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
