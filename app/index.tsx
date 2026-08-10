import { useEffect, useRef, useState, useCallback } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import Constants from 'expo-constants';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function App() {
  const isWeb = Platform.OS === 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pendingCapture, setPendingCapture] = useState(false);

  const cameraRef = useRef<CameraView | null>(null);
  const isCameraReadyRef = useRef(isCameraReady);

  // Giữ ref luôn cập nhật để handler trong WebSocket đọc đúng state mới nhất
  useEffect(() => {
    isCameraReadyRef.current = isCameraReady;
  }, [isCameraReady]);

  // Đọc thông số WebSocket từ Constants
  const extra = Constants.expoConfig?.extra as { WS_HOST?: string; WS_PORT?: string } | undefined;
  const wsHost = extra?.WS_HOST || '192.168.1.101';
  const wsPort = extra?.WS_PORT || '3333';
  const wsUrl = `ws://${wsHost}:${wsPort}`;

  // Yêu cầu quyền truy cập Camera nếu chưa được cấp
  useEffect(() => {
    if (!isWeb && (!permission || !permission.granted)) {
      requestPermission();
    }
  }, [isWeb, permission, requestPermission]);

  // Hàm xử lý chụp ảnh
  const handleTakePicture = useCallback(async () => {
    if (!cameraRef.current || !isCameraReadyRef.current) {
      Alert.alert('Cảnh báo', 'Camera chưa sẵn sàng!');
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: false,
        quality: 0.8,
      });

      if (photo?.uri) {
        setPhotoUri(photo.uri);
        setPendingCapture(false);
        Alert.alert('Thành công', `Ảnh đã lưu tại: ${photo.uri}`);
      }
    } catch (error) {
      console.error('Lỗi khi chụp ảnh:', error);
      Alert.alert('Lỗi', 'Không thể chụp ảnh');
    }
  }, []);

  // Xử lý yêu cầu chụp pending khi camera vừa sẵn sàng
  useEffect(() => {
    if (pendingCapture && isCameraReady) {
      handleTakePicture();
    }
  }, [pendingCapture, isCameraReady, handleTakePicture]);

  // Quản lý WebSocket Connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connectWebSocket = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`[WS] Connected to ${wsUrl}`);
      };

      ws.onmessage = async event => {
        console.log('[WS] Message received:', event.data);
        if (event.data === 'TAKE_PHOTO') {
          if (isCameraReadyRef.current && cameraRef.current) {
            console.log('take_photo');
            await handleTakePicture();
          } else {
            console.log('[WS] Camera chưa sẵn sàng, đã đưa vào hàng chờ...');
            setPendingCapture(true);
          }
        }
      };

      ws.onerror = error => {
        console.error('[WS] Error:', error);
      };

      ws.onclose = () => {
        console.log('[WS] Closed. Retrying in 3 seconds...');
        // Tự động kết nối lại sau 3 giây nếu mất kết nối
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    return () => {
      if (ws) {
        ws.onclose = null; // Huỷ trigger reconnect khi unmount
        ws.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [wsUrl, handleTakePicture]);

  // UI rendering các trạng thái đặc biệt
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

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.infoText}>Đang kiểm tra quyền camera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Ứng dụng chưa được cấp quyền truy cập Camera.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={() => setIsCameraReady(true)}
      />

      <View style={styles.footer}>
        <Text style={styles.statusTitle}>WebSocket: {wsUrl}</Text>
        <Text style={styles.statusText}>
          Trạng thái Camera: {isCameraReady ? '🟢 Sẵn sàng' : '🟡 Đang khởi tạo...'}
        </Text>

        {photoUri && (
          <View style={styles.previewContainer}>
            <Text style={styles.previewLabel}>Ảnh mới chụp:</Text>
            <Image source={{ uri: photoUri }} style={styles.previewImage} />
            <Text style={styles.previewPath} numberOfLines={1} ellipsizeMode="middle">
              {photoUri}
            </Text>
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
  camera: {
    flex: 1,
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  statusTitle: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  statusText: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  previewContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  previewLabel: {
    fontWeight: 'bold',
    marginBottom: 8,
    fontSize: 14,
  },
  previewImage: {
    width: 180,
    height: 180,
    borderRadius: 12,
    backgroundColor: '#eee',
    marginBottom: 8,
  },
  previewPath: {
    fontSize: 11,
    color: '#888',
    width: '100%',
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  infoText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
  subText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
  },
  errorText: {
    fontSize: 15,
    color: 'red',
    textAlign: 'center',
  },
});
