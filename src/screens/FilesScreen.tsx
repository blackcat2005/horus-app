/**
 * Files Screen
 * Quản lý file đã chụp/quay trên máy và thư viện video trên server (API v1).
 * - Tab "Trên máy": upload video lên server bằng luồng chunked upload,
 *   chuyển file ra Photos, xóa file local.
 * - Tab "Trên server": danh sách video từ GET /videos; xem phát lại,
 *   tải về (chỉ Controller), xóa.
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/core';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { logger } from '../utils/logger';
import { getDeviceId } from '../utils/device';
import { localStore, CapturedFile } from '../services/localStore';
import { uploadService } from '../services/upload';
import { authStore } from '../services/authStore';
import { listVideos, getVideo, deleteVideo, getDownloadUrl } from '../api/videos';
import { ApiError } from '../api/client';
import { ServerVideo } from '../api/types';
import { colors, spacing, radius } from '../constants/theme';

type Tab = 'local' | 'server';

export default function FilesScreen() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('local');

  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [videos, setVideos] = useState<ServerVideo[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isController, setIsController] = useState(false);

  useEffect(() => {
    localStore.initialize();
    getDeviceId().then(id => setDeviceId(id));
    authStore.load().then(session => setIsController(session?.accountRole === 'controller'));
  }, []);

  const doLoad = useCallback(async (): Promise<void> => {
    const list = await localStore.listCapturedFiles();
    setFiles(list);
    setLoading(false);
  }, []);

  const loadServerVideos = useCallback(async (): Promise<void> => {
    setServerLoading(true);
    setServerError(null);
    try {
      const data = await listVideos({ index: 0, count: 50 });
      setVideos(data.videos || []);
    } catch (error) {
      logger.error('Failed to load server videos', error);
      setServerError(error instanceof ApiError ? error.message : 'Không tải được danh sách video');
    } finally {
      setServerLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      doLoad();
      if (tab === 'server') {
        loadServerVideos();
      }
    }, [doLoad, tab, loadServerVideos]),
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
        Alert.alert(
          'Chưa hỗ trợ',
          'API v1 hiện chỉ nhận video mp4. Ảnh vui lòng xuất sang Photos.',
        );
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
        Alert.alert(
          'Đã upload',
          `${file.fileName} đã nằm trên server${result.videoId ? ` (video_id: ${result.videoId})` : ''}.`,
        );
      } catch (error) {
        logger.error('Failed to upload video', error);
        const message =
          error instanceof ApiError ? `${error.message} (mã ${error.code})` : 'Upload thất bại.';
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

  const handlePlay = useCallback(async (video: ServerVideo) => {
    try {
      const detail = await getVideo(video.id);
      await Linking.openURL(detail.url);
    } catch (error) {
      logger.error('Failed to open video url', error);
      Alert.alert('Lỗi', 'Không mở được đường dẫn phát video.');
    }
  }, []);

  const handleDownload = useCallback(async (video: ServerVideo) => {
    try {
      const data = await getDownloadUrl(video.id);
      await Linking.openURL(data.download_url);
    } catch (error) {
      logger.error('Failed to get download url', error);
      const message =
        error instanceof ApiError && error.code === 1009
          ? 'Chỉ tài khoản Controller mới được tải clip.'
          : 'Không lấy được link tải.';
      Alert.alert('Lỗi', message);
    }
  }, []);

  const handleDeleteServer = useCallback(
    (video: ServerVideo) => {
      Alert.alert('Xóa video', `Xóa "${video.name || video.id}" trên server?`, [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVideo(video.id);
              await loadServerVideos();
            } catch (error) {
              Alert.alert('Lỗi', error instanceof ApiError ? error.message : 'Xóa thất bại.');
            }
          },
        },
      ]);
    },
    [loadServerVideos],
  );

  const onRefresh = useCallback(async () => {
    if (tab === 'local') {
      await doLoad();
    } else {
      await loadServerVideos();
    }
  }, [tab, doLoad, loadServerVideos]);

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
              style={[
                styles.actionButton,
                styles.uploadButton,
                (isUploading || item.uploaded) && styles.buttonDisabled,
              ]}
              onPress={() => handleUpload(item)}
              disabled={!!uploadingId || !!item.uploaded}>
              <Text style={styles.actionButtonText}>
                {item.uploaded
                  ? '✓ Đã upload'
                  : isUploading
                    ? `⬆️ ${uploadProgress}%`
                    : '⬆️ Upload'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionButton, styles.exportButton, isExporting && styles.buttonDisabled]}
            onPress={() => handleExport(item)}
            disabled={!!exportingId}>
            <Text style={styles.actionButtonText}>
              {isExporting ? 'Đang chuyển...' : '📂 Photos'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteLocal(item)}>
            <Text style={styles.actionButtonText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderServerItem = (video: ServerVideo) => {
    const date = video.created_at ? new Date(video.created_at).toLocaleString() : '';
    return (
      <View key={video.id} style={styles.fileRow}>
        <View style={[styles.fileThumb, styles.videoThumb]}>
          <Text style={styles.fileThumbIcon}>☁️</Text>
        </View>

        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={1}>
            {video.name || video.camera_name || video.local_video_uid || video.id}
          </Text>
          <Text style={styles.fileMeta}>
            {[date, formatSize(video.size), video.camera_name].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.uploadButton]}
            onPress={() => handlePlay(video)}>
            <Text style={styles.actionButtonText}>▶ Xem</Text>
          </TouchableOpacity>
          {isController && (
            <TouchableOpacity
              style={[styles.actionButton, styles.exportButton]}
              onPress={() => handleDownload(video)}>
              <Text style={styles.actionButtonText}>⬇ Tải</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteServer(video)}>
            <Text style={styles.actionButtonText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.infoText}>Đang tải danh sách file...</Text>
      </View>
    );
  }

  const photos = files.filter(f => f.type === 'photo');
  const videosLocal = files.filter(f => f.type === 'video');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitle}>Files</Text>
          <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.refreshLink}>⟳ Làm mới</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabButton, tab === 'local' && styles.tabActive]}
            onPress={() => setTab('local')}>
            <Text style={[styles.tabText, tab === 'local' && styles.tabTextActive]}>Trên máy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, tab === 'server' && styles.tabActive]}
            onPress={() => {
              setTab('server');
              loadServerVideos();
            }}>
            <Text style={[styles.tabText, tab === 'server' && styles.tabTextActive]}>
              Trên server
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
        {tab === 'local' ? (
          <>
            {photos.length > 0 && (
              <Text style={styles.sectionHeader}>Ảnh đã lưu ({photos.length})</Text>
            )}
            {photos.map(renderLocalItem)}
            {videosLocal.length > 0 && (
              <Text style={styles.sectionHeader}>Video đã lưu ({videosLocal.length})</Text>
            )}
            {videosLocal.map(renderLocalItem)}
            {files.length === 0 && (
              <View style={styles.center}>
                <Text style={styles.emptyText}>
                  Chưa có file nào. Hãy chụp ảnh hoặc quay video trong tab Camera.
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            {serverLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.serverSpinner} />
            ) : serverError ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{serverError}</Text>
              </View>
            ) : videos.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>Chưa có video nào trên server.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionHeader}>
                  Video trên server ({videos.length})
                  {isController ? ' · Controller: thấy tất cả' : ''}
                </Text>
                {videos.map(renderServerItem)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  refreshLink: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  tabRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.primary,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  fileThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    marginRight: spacing.md,
    backgroundColor: colors.primaryLight,
  },
  videoThumb: {
    backgroundColor: colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileThumbIcon: {
    fontSize: 22,
  },
  fileInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  fileMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  uploadedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successLight,
    borderRadius: radius.round,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  uploadedTag: {
    fontSize: 11,
    color: colors.successDark,
    fontWeight: '600',
  },
  actions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  uploadButton: {
    backgroundColor: colors.primary,
  },
  exportButton: {
    backgroundColor: colors.success,
  },
  deleteButton: {
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  actionButtonText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    backgroundColor: colors.textMuted,
  },
  infoText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 10,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: colors.dangerDark,
    textAlign: 'center',
  },
  serverSpinner: {
    marginTop: spacing.xl,
  },
});
