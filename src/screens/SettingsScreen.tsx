/**
 * Settings Screen
 * Cho phép nhập địa chỉ IP/port của server ngay trong app (lưu AsyncStorage),
 * không cần sửa app.json mỗi lần. Hỗ trợ kiểm tra kết nối tới server.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, spacing, radius } from '../constants/theme';
import { serverConfigService } from '../services/serverConfig';
import { authStore } from '../services/authStore';
import { logout } from '../api/auth';
import { getDeviceId } from '../utils/device';
import { logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [account, setAccount] = useState<{ name: string; role: string; phone: string } | null>(
    null,
  );

  useEffect(() => {
    serverConfigService.load().then(config => {
      setHost(config.host);
      setPort(config.port);
      setIsLoading(false);
    });
    getDeviceId().then(setDeviceId);
    authStore.load().then(session => {
      if (session) {
        const { user, accountRole } = session;
        setAccount({
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
          role: accountRole === 'controller' ? 'Controller' : 'Remote',
          phone: user.phone || user.email,
        });
      }
    });
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Đăng xuất', 'Bạn muốn đăng xuất khỏi tài khoản này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          try { await logout(); } catch(e){ logger.warn('logout api failed, forcing clear', e); await authStore.clear(); }
          // Fallback nếu AuthGate chưa kịp chuyển (do token cũ 9992)
          setTimeout(async()=>{ const s=await authStore.load(); if(s) { await AsyncStorage.removeItem('auth_session'); await authStore.clear(); } }, 800);
        },
      },
    ]);
  }, []);

  const handleForceClear = useCallback(async()=>{
    Alert.alert('Buộc đăng xuất', 'Xóa session local và quay về màn đăng nhập? (Dùng khi "Đăng xuất" không phản hồi do 9992)', [
      { text: 'Hủy', style:'cancel'},
      { text:'Xóa & đăng nhập lại', style:'destructive', onPress: async()=>{
        try{ await AsyncStorage.removeItem('auth_session'); }catch{}
        await authStore.clear();
        // Xoá deviceId cũ nếu bị kẹt "not owned by user" do DB reset — lần sau getDeviceId sẽ tạo mới
        try{ await AsyncStorage.removeItem('app_device_id'); }catch{}
        Alert.alert('Đã xóa', 'Vui lòng khởi động lại app và đăng nhập lại (0900000002/Remote@123).');
      }}
    ]);
  },[]);

  const handleSave = useCallback(async () => {
    const trimmedHost = host.trim();
    const trimmedPort = port.trim();

    if (!trimmedHost) {
      Alert.alert('Lỗi', 'Vui lòng nhập địa chỉ IP của máy chạy server.');
      return;
    }

    const portNumber = parseInt(trimmedPort, 10);
    if (!trimmedPort || Number.isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
      Alert.alert('Lỗi', 'Port không hợp lệ (1-65535).');
      return;
    }

    setIsSaving(true);
    await serverConfigService.save(trimmedHost, trimmedPort);
    setIsSaving(false);
    setTestResult(null);
    Alert.alert('Đã lưu', 'Cấu hình đã lưu. Tab Camera sẽ tự động kết nối lại.');
  }, [host, port]);

  const handleTest = useCallback(async () => {
    const trimmedHost = host.trim();
    const trimmedPort = port.trim();
    if (!trimmedHost || !trimmedPort) {
      Alert.alert('Lỗi', 'Vui lòng nhập host và port trước khi kiểm tra.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `http://${trimmedHost}:${trimmedPort}/health`;
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        setTestResult(body?.data?.status === 'up' ? 'success' : 'fail');
      } else {
        setTestResult('fail');
      }
    } catch (error) {
      logger.warn('Connection test failed', error);
      setTestResult('fail');
    } finally {
      clearTimeout(timeout);
      setIsTesting(false);
    }
  }, [host, port]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Cài đặt kết nối</Text>
          <Text style={styles.headerSub}>
            Nhập địa chỉ IP và port của máy đang chạy server. Thông tin sẽ được lưu trên thiết bị và
            dùng cho lần mở app tiếp theo.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Địa chỉ IP server</Text>
              <TextInput
                style={styles.input}
                value={host}
                onChangeText={setHost}
                placeholder="VD: 192.168.1.102"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              <Text style={styles.label}>Port</Text>
              <TextInput
                style={styles.input}
                value={port}
                onChangeText={setPort}
                placeholder="VD: 3000"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
              />

              <TouchableOpacity
                style={[styles.button, isSaving && styles.buttonDisabled]}
                onPress={handleSave}
                disabled={isSaving}>
                <Text style={styles.buttonText}>
                  {isSaving ? 'Đang lưu...' : '💾 Lưu & kết nối lại'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonGhost, isTesting && styles.buttonDisabled]}
                onPress={handleTest}
                disabled={isTesting}>
                <Text style={styles.buttonGhostText}>
                  {isTesting ? 'Đang kiểm tra...' : '📡 Kiểm tra kết nối'}
                </Text>
              </TouchableOpacity>

              {testResult && (
                <View
                  style={[
                    styles.testResult,
                    testResult === 'success' ? styles.testOk : styles.testFail,
                  ]}>
                  <Text
                    style={[
                      styles.testResultText,
                      testResult === 'success' ? styles.testOkText : styles.testFailText,
                    ]}>
                    {testResult === 'success'
                      ? '✓ Server phản hồi tốt'
                      : '✕ Không kết nối được tới server. Kiểm tra IP, port và firewall.'}
                  </Text>
                </View>
              )}
            </View>

            {account && (
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Tài khoản</Text>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Tên</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {account.name}
                  </Text>
                </View>
                <View style={[styles.infoRow, styles.infoRowGap]}>
                  <Text style={styles.infoLabel}>Vai trò</Text>
                  <Text style={styles.infoValue}>{account.role}</Text>
                </View>
                <View style={[styles.infoRow, styles.infoRowGap]}>
                  <Text style={styles.infoLabel}>Liên hệ</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {account.phone}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.button, styles.logoutButton]}
                  onPress={handleLogout}>
                  <Text style={styles.buttonText}>🚪 Đăng xuất</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, {backgroundColor: colors.textSecondary, marginTop: spacing.sm}]}
                  onPress={handleForceClear}>
                  <Text style={styles.buttonText}>🧹 Buộc đăng xuất (xóa session)</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Thông tin thiết bị</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device ID</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {deviceId}
                </Text>
              </View>
              <Text style={styles.infoNote}>
                Device ID giúp bạn nhận diện thiết bị này trên dashboard của server.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: 'bold',
  },
  buttonGhost: {
    backgroundColor: colors.primaryLight,
    marginTop: spacing.sm,
  },
  buttonGhostText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  testResult: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  testOk: {
    backgroundColor: colors.successLight,
  },
  testFail: {
    backgroundColor: colors.dangerLight,
  },
  testResultText: {
    fontSize: 13,
    fontWeight: '600',
  },
  testOkText: {
    color: colors.successDark,
  },
  testFailText: {
    color: colors.dangerDark,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
    flexShrink: 1,
    marginLeft: spacing.md,
    textAlign: 'right',
  },
  infoNote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  infoRowGap: {
    marginTop: spacing.md,
  },
  logoutButton: {
    backgroundColor: colors.danger,
  },
  loadingBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
});
