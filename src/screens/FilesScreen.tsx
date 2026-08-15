/**
 * Files Screen
 * Tab quản lý các file (ảnh/video) đã chụp/quay và lưu trong bộ nhớ local.
 * Tự động làm mới khi tab được focus; hỗ trợ chuyển (copy) file ra thư viện ảnh Photos
 * và upload file lên server.
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/core';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { logger } from '../utils/logger';
import { getDeviceId } from '../utils/device';
import { localStore, CapturedFile } from '../services/localStore';
import { uploadService } from '../services/upload';
import { serverConfigService } from '../services/serverConfig';
import { colors, spacing, radius } from '../constants/theme';

const REFRESH_INTERVAL_MS = 3000;

export default function FilesScreen() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [files, setFiles] = useState<CapturedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const doLoad = useCallback(async (): Promise<void> => {
    const list = await localStore.listCapturedFiles();
    setFiles(list);
  }, []);

  useEffect(() => {
    localStore.initialize();

    // Khởi tạo uploadService theo cấu hình server đã lưu (tự cập nhật khi đổi cấu hình)
    serverConfigService.load().then(config => {
      uploadService.initialize(serverConfigService.httpUrl(config));
    });
    const unsubscribe = serverConfigService.subscribe(config => {
      uploadService.initialize(serverConfigService.httpUrl(config));
    });

    getDeviceId().then(id => setDeviceId(id));

    let mounted = true;
    const load = async () => {
      const list = await localStore.listCapturedFiles();
      if (mounted) {
        setFiles(list);
        setLoading(false);
      }
    };
    load();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Tự động làm mới danh sách khi tab được focus + poll định kỳ
  useFocusEffect(
    useCallback(() => {
      doLoad();
      const interval = setInterval(() => {
        doLoad();
      }, REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
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
      if (!deviceId) {
        Alert.alert('Lỗi', 'Chưa có device ID');
        return;
      }

      setUploadingId(file.id);
      setUploadProgress(0);

      try {
        const uploaded =
          file.type === 'photo'
            ? await uploadService.uploadPhoto(file.localUri, deviceId, p => setUploadProgress(p))
            : await uploadService.uploadVideo(file.localUri, deviceId, p => setUploadProgress(p));

        if (uploaded) {
          await localStore.markUploaded(file.id);
          await doLoad();
          Alert.alert('Đã upload', `${file.fileName} đã được upload lên server.`);
        } else {
          Alert.alert('Lỗi', `Upload ${file.fileName} lên server thất bại.`);
        }
      } catch (error) {
        logger.error('Failed to upload file', error);
        Alert.alert('Lỗi', 'Không thể upload file lên server.');
      } finally {
        setUploadingId(null);
      }
    },
    [uploadingId, deviceId, doLoad],
  );

  const handleDelete = useCallback(
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

  const photos = files.filter(f => f.type === 'photo');
  const videos = files.filter(f => f.type === 'video');

  const renderItem = useCallback(
    ({ item }: { item: CapturedFile }) => {
      const isPhoto = item.type === 'photo';
      const date = new Date(item.createdAt).toLocaleString();
      const isExporting = exportingId === item.id;
      const isUploading = uploadingId === item.id;

      return (
        <View style={styles.fileRow}>
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
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.exportButton,
                isExporting && styles.buttonDisabled,
              ]}
              onPress={() => handleExport(item)}
              disabled={!!exportingId}>
              <Text style={styles.actionButtonText}>
                {isExporting ? 'Đang chuyển...' : '📂 Vào Photos'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item)}>
              <Text style={styles.actionButtonText}>🗑️</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [exportingId, uploadingId, uploadProgress, handleUpload, handleExport, handleDelete],
  );

  const renderSection = useCallback(
    (title: string, items: CapturedFile[]) => {
      if (items.length === 0) return null;
      return (
        <View>
          <Text style={styles.sectionHeader}>{title}</Text>
          {items.map(item => (
            <View key={item.id}>{renderItem({ item })}</View>
          ))}
        </View>
      );
    },
    [renderItem],
  );

  const sections = [
    { key: 'photos', title: 'Ảnh đã lưu', items: photos },
    { key: 'videos', title: 'Video đã lưu', items: videos },
  ];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.infoText}>Đang tải danh sách file...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Files đã lưu trên thiết bị</Text>
        <View style={styles.headerSubRow}>
          <Text style={styles.headerSub}>
            Bấm Upload để gửi file lên server, &quot;Vào Photos&quot; để chuyển ra thư viện ảnh.
          </Text>
          <TouchableOpacity
            onPress={() => onRefresh()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.refreshLink}>⟳ Làm mới</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={sections}
        keyExtractor={item => item.key}
        renderItem={({ item }) => renderSection(item.title, item.items)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>
              Chưa có file nào. Hãy chụp ảnh hoặc quay video trong tab Camera.
            </Text>
          </View>
        }
      />
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
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerSubRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSub: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    marginRight: spacing.sm,
  },
  refreshLink: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: spacing.lg,
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
});
