import React, { useEffect, useRef, useState, type ElementRef } from 'react';
import { Alert, Image, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Camera, CameraView } from 'expo-camera';

export default function App() {
  const isWeb = Platform.OS === 'web';
  const [hasPermission, setHasPermission] = useState<boolean | null>(isWeb ? true : null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [pendingCaptureRequest, setPendingCaptureRequest] = useState(false);
  const cameraRef = useRef<ElementRef<typeof CameraView> | null>(null);

  const extra = Constants.expoConfig?.extra as { WS_HOST?: string; WS_PORT?: string } | undefined;
  const wsHost = extra?.WS_HOST || '192.168.1.101';
  const wsPort = extra?.WS_PORT || '3333';
  const wsUrl = `ws://${wsHost}:${wsPort}`;

  useEffect(() => {
    if (isWeb) {
      return;
    }

    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, [isWeb]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => console.log('WebSocket connected', wsUrl);
    ws.onmessage = async (event) => {
      if (event.data === 'TAKE_PHOTO') {
        if (isCameraReady && cameraRef.current) {
          await handleTakePicture();
        } else {
          console.log('Đang chờ camera sẵn sàng để chụp ảnh');
          setPendingCaptureRequest(true);
        }
      }
    };
    ws.onerror = (event) => console.error('WebSocket error', event);
    ws.onclose = () => console.log('WebSocket closed');

    return () => {
      ws.close();
    };
  }, [isCameraReady, wsUrl]);

  const handleTakePicture = async () => {
    if (!cameraRef.current || !isCameraReady) {
      Alert.alert('Camera chưa sẵn sàng');
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: false });
      setPhotoUri(photo.uri);
      setPendingCaptureRequest(false);
      Alert.alert('Đã chụp ảnh', `Ảnh lưu tại: ${photo.uri}`);
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi', 'Không thể chụp ảnh');
    }
  };

  useEffect(() => {
    if (pendingCaptureRequest && isCameraReady && cameraRef.current) {
      handleTakePicture();
    }
  }, [pendingCaptureRequest, isCameraReady]);

  if (!isWeb && hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text>Đang yêu cầu quyền...</Text>
      </View>
    );
  }

  if (!isWeb && hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>Không có quyền truy cập camera</Text>
      </View>
    );
  }

  if (isWeb) {
    return (
      <View style={styles.container}>
        <View style={styles.footer}>
          <Text>Web không hỗ trợ camera native trong app này.</Text>
          <Text>Hãy chạy trên thiết bị hoặc emulator dùng Expo Go.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        ref={cameraRef}
        onCameraReady={() => setIsCameraReady(true)}
      />
      <View style={styles.footer}>
        <Text>WebSocket lắng nghe máy chủ trên {wsUrl}</Text>
        <Text>Trạng thái máy ảnh: {isCameraReady ? 'Sẵn sàng' : 'Đang khởi tạo'}</Text>
        {photoUri ? (
          <View style={styles.previewContainer}>
            <Text style={styles.previewLabel}>Ảnh đã chụp</Text>
            <Image source={{ uri: photoUri }} style={styles.previewImage} />
            <Text style={styles.previewPath}>{photoUri}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
  },
  previewContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  previewLabel: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  previewImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: '#000',
    marginBottom: 8,
  },
  previewPath: {
    fontSize: 12,
    color: '#666',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
