/**
 * Files Screen — chỉ hiển thị file trên máy (không lấy trên server)
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { logger } from '../utils/logger';
import { getDeviceId } from '../utils/device';
import { localStore, CapturedFile } from '../services/localStore';
import { uploadService } from '../services/upload';
import { ApiError } from '../api/client';
import { colors, spacing, radius } from '../constants/theme';

export default function FilesScreen() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    localStore.initialize();
    getDeviceId().then(id => setDeviceId(id));
  }, []);

  const doLoad = useCallback(async (): Promise<void> => {
    const list = await localStore.listCapturedFiles();
    setFiles(list);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      doLoad();
    }, [doLoad]),
  );

  const handleExport = useCallback(
    async (file: CapturedFile) => {
      if (exportingId) return;
      setExportingId(file.id);
      try {
        const ok = await localStore.exportToGallery(file.id);
        if (ok) {
          Alert.alert('Đã lưu vào Photos', `${file.fileName} đã được chuyển vào thư viện ảnh.`);
        } else {
          Alert.alert('Lỗi', 'Không thể chuyển file vào thư viện ảnh. Kiểm tra quyền truy cập.');
        }
      } catch (error) {
        logger.error('Failed to export file', error);
        Alert.alert('Lỗi', 'Không thể chuyển file vào thư viện ảnh.');
      } finally {
        setExportingId(null);
      }
    },
    [exportingId],
  );

  const handleUpload = useCallback(
    async (file: CapturedFile) => {
      if (uploadingId) return;
      if (file.type !== 'video') {
        Alert.alert('Chưa hỗ trợ', 'API v1 hiện chỉ nhận video mp4. Ảnh vui lòng xuất sang Photos.');
        return;
      }
      if (!deviceId) {
        Alert.alert('Lỗi', 'Chưa có device ID');
        return;
      }
      setUploadingId(file.id);
      setUploadProgress(0);
      try {
        const result = await uploadService.uploadVideo(
          file.localUri,
          {
            localVideoUid: file.id,
            deviceId,
            cameraName: 'Remote Camera',
            sessionId: 'standalone',
            recordedAt: new Date(file.createdAt).toISOString(),
          },
          p => setUploadProgress(p),
        );
        await localStore.markUploaded(file.id);
        await doLoad();
        Alert.alert('Đã upload', `${file.fileName} đã nằm trên server${result.videoId ? ` (video_id: ${result.videoId})` : ''}.`);
      } catch (error) {
        logger.error('Failed to upload video', error);
        const message = error instanceof ApiError ? `${error.message} (mã ${error.code})` : 'Upload thất bại.';
        Alert.alert('Lỗi upload', message);
      } finally {
        setUploadingId(null);
      }
    },
    [uploadingId, deviceId, doLoad],
  );

  const handleDeleteLocal = useCallback(
    (file: CapturedFile) => {
      Alert.alert('Xóa file', `Xóa ${file.fileName} khỏi bộ nhớ?`, [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            const ok = await localStore.deleteCapturedFile(file.id);
            if (ok) {
              await doLoad();
              Alert.alert('Đã xóa');
            } else {
              Alert.alert('Lỗi', 'Không thể xóa file.');
            }
          },
        },
      ]);
    },
    [doLoad],
  );

  const onRefresh = useCallback(async () => {
    await doLoad();
  }, [doLoad]);

  const renderLocalItem = (item: CapturedFile) => {
    const isPhoto = item.type === 'photo';
    const date = new Date(item.createdAt).toLocaleString();
    const isExporting = exportingId === item.id;
    const isUploading = uploadingId === item.id;
    return (
      <View key={item.id} style={styles.fileRow}>
        {isPhoto ? (
          <Image source={{ uri: item.localUri }} style={styles.fileThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.fileThumb, styles.videoThumb]}>
            <Text style={styles.fileThumbIcon}>🎬</Text>
          </View>
        )}
        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={styles.fileMeta}>
            {date} · {formatSize(item.size)}
          </Text>
          {item.uploaded && (
            <View style={styles.uploadedBadge}>
              <Text style={styles.uploadedTag}>✓ Đã upload lên server</Text>
            </View>
          )}
        </View>
        <View style={styles.actions}>
          {!isPhoto && (
            <TouchableOpacity
              style={[styles.actionButton, styles.uploadButton, (isUploading || item.uploaded) && styles.buttonDisabled]}
              onPress={() => handleUpload(item)}
              disabled={!!uploadingId || !!item.uploaded}>
              <Text style={styles.actionButtonText}>{item.uploaded ? '✓ Đã upload' : isUploading ? `⬆️ ${uploadProgress}%` : '⬆️ Upload'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, styles.exportButton, isExporting && styles.buttonDisabled]}
            onPress={() => handleExport(item)}
            disabled={!!exportingId}>
            <Text style={styles.actionButtonText}>{isExporting ? 'Đang chuyển...' : '📂 Photos'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteLocal(item)}>
            <Text style={styles.actionButtonText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.infoText}>Đang tải danh sách file...</Text>
      </SafeAreaView>
    );
  }

  const photos = files.filter(f => f.type === 'photo');
  const videosLocal = files.filter(f => f.type === 'video');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerIconWrap}><Text style={styles.headerIcon}>🗂️</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Files</Text>
            <Text style={styles.headerSub}>Trên máy • {files.length} file</Text>
          </View>
          <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.refreshBtn}>
            <Text style={styles.refreshLink}>⟳</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
        {photos.length > 0 && <Text style={styles.sectionHeader}>Ảnh đã lưu ({photos.length})</Text>}
        {photos.map(renderLocalItem)}
        {videosLocal.length > 0 && <Text style={styles.sectionHeader}>Video đã lưu ({videosLocal.length})</Text>}
        {videosLocal.map(renderLocalItem)}
        {files.length === 0 && (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Chưa có file nào. Hãy quay preview (tự lưu) hoặc chụp/quay trong tab Camera.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, paddingTop: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  headerTopRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  headerIcon: { fontSize: 18 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  refreshBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  refreshLink: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  listContent: { padding: spacing.md, paddingBottom: 24, gap: spacing.sm },
  sectionHeader: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1, gap: spacing.sm },
  fileThumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  videoThumb: { backgroundColor: colors.dangerLight, justifyContent: 'center', alignItems: 'center' },
  fileThumbIcon: { fontSize: 18 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 13, fontWeight: '600', color: colors.text },
  fileMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  uploadedBadge: { alignSelf: 'flex-start', backgroundColor: colors.successLight, borderRadius: radius.round, paddingHorizontal: 6, paddingVertical: 1, marginTop: 3 },
  uploadedTag: { fontSize: 10, color: colors.successDark, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionButton: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.sm },
  uploadButton: { backgroundColor: colors.primary },
  exportButton: { backgroundColor: colors.success },
  deleteButton: { backgroundColor: colors.danger, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.sm },
  actionButtonText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  buttonDisabled: { backgroundColor: colors.textMuted },
  infoText: { fontSize: 14, color: colors.textSecondary, marginTop: 10, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
