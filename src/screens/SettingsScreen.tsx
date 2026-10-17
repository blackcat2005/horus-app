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
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, radius } from '../constants/theme';
import { serverConfigService } from '../services/serverConfig';
import { authStore } from '../services/authStore';
import { logout } from '../api/auth';
import { getDeviceId } from '../utils/device';
import { logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { discoverServers, DiscoveredServer } from '../services/discovery';

export default function SettingsScreen() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [foundServers, setFoundServers] = useState<DiscoveredServer[] | null>(null);
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
        // Rời phòng trên server trước (best-effort) → tránh member "xác" còn nằm lại.
        try{ await logout(); }catch{}
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

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    setFoundServers(null);
    setTestResult(null);
    try {
      const servers = await discoverServers(5000);
      setFoundServers(servers);
      if (servers.length === 0) {
        Alert.alert(
          'Không tìm thấy server',
          'Không thấy server Multicam nào trên mạng LAN. Kiểm tra:\n' +
            '• Điện thoại và máy chạy server cùng 1 wifi\n' +
            '• Server đang chạy (discovery mDNS + UDP 55666)\n' +
            '• Hoặc nhập IP/port thủ công bên dưới.',
        );
      }
    } catch (err) {
      logger.error('Scan failed', err);
      Alert.alert('Quét lỗi', 'Không thực hiện được quét mạng (cần dev build có react-native-zeroconf).');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handlePickServer = useCallback(
    (s: DiscoveredServer) => {
      const ip = s.host || s.addresses[0] || '';
      const port = String(s.port || 3000);
      if (!ip) return;
      setHost(ip);
      setPort(port);
      setFoundServers(null);
      Alert.alert('Đã chọn server', `${ip}:${port} (${s.txt?.server_name || s.name}) — bấm 💾 Lưu để áp dụng.`);
    },
    [],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerIconWrap}><Text style={styles.headerIcon}>⚙️</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Cài đặt</Text>
              <Text style={styles.headerSub}>Server & tài khoản</Text>
            </View>
          </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🖥️ Server</Text>
              <View style={styles.row}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>IP</Text>
                  <TextInput
                    style={styles.input}
                    value={host}
                    onChangeText={setHost}
                    placeholder="192.168.1.6"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Port</Text>
                  <TextInput
                    style={styles.input}
                    value={port}
                    onChangeText={setPort}
                    placeholder="3000"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.button, styles.buttonFlex, isSaving && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={isSaving}>
                  <Text style={styles.buttonText}>{isSaving ? '...' : '💾 Lưu'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.buttonGhost, styles.buttonFlex, isTesting && styles.buttonDisabled]}
                  onPress={handleTest}
                  disabled={isTesting}>
                  <Text style={styles.buttonGhostText}>{isTesting ? '...' : '📡 Test'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, styles.scanButton, isScanning && styles.buttonDisabled]}
                onPress={handleScan}
                disabled={isScanning}>
                <Text style={styles.scanButtonText}>{isScanning ? 'Đang quét mạng...' : '🔎 Quét server (mDNS)'}</Text>
              </TouchableOpacity>

              {foundServers && foundServers.length > 0 && (
                <View style={styles.scanResults}>
                  {foundServers.map(s => {
                    const ip = s.host || s.addresses[0] || '';
                    const label = s.txt?.server_name || s.name || `${ip}:${s.port}`;
                    return (
                      <TouchableOpacity key={`${ip}:${s.port}`} style={styles.scanItem} onPress={() => handlePickServer(s)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.scanItemName}>{label}</Text>
                          <Text style={styles.scanItemSub}>{ip}:{s.port}</Text>
                        </View>
                        <Text style={styles.scanItemPick}>Chọn ›</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={styles.scanNote}>Tap một server để điền IP/Port, sau đó bấm 💾 Lưu.</Text>
                </View>
              )}

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
                <View style={styles.infoCardHeader}>
                  <Text style={styles.infoTitle}>👤 {account.name}</Text>
                  <View style={[styles.badge, account.role === 'Controller' ? styles.badgeController : styles.badgeRemote]}>
                    <Text style={styles.badgeText}>{account.role}</Text>
                  </View>
                </View>
                <Text style={styles.infoValueSmall} numberOfLines={1}>{account.phone}</Text>
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.logoutButton, styles.buttonFlex]} onPress={handleLogout}>
                    <Text style={styles.buttonText}>🚪 Thoát</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.buttonGhost, styles.buttonFlex]} onPress={handleForceClear}>
                    <Text style={styles.buttonGhostText}>🧹 Xóa</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>📱 Thiết bị</Text>
              <Text style={styles.infoValueMono} numberOfLines={1}>{deviceId}</Text>
              <Text style={styles.infoNote}>Dùng để nhận diện trên dashboard</Text>
            </View>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 24, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  headerIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  headerIcon: { fontSize: 20 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, marginTop: spacing.sm },
  input: { backgroundColor: colors.background, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', marginTop: spacing.md },
  buttonFlex: { flex: 1 },
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
  scanButton: {
    backgroundColor: colors.primaryLight,
    marginTop: spacing.sm,
  },
  scanButtonText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: 'bold',
  },
  scanResults: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  scanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scanItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  scanItemSub: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  scanItemPick: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  scanNote: {
    fontSize: 11,
    color: colors.textMuted,
  },
  infoCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  infoTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.round },
  badgeController: { backgroundColor: colors.primaryLight },
  badgeRemote: { backgroundColor: colors.successLight },
  badgeText: { fontSize: 11, fontWeight: '800', color: colors.primaryDark },
  infoValueSmall: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  infoValueMono: { fontSize: 11, color: colors.text, fontFamily: 'monospace', marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLabel: { fontSize: 13, color: colors.textSecondary },
  infoValue: { fontSize: 13, color: colors.text, fontWeight: '600', flexShrink: 1, marginLeft: spacing.md, textAlign: 'right' },
  infoNote: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  infoRowGap: { marginTop: spacing.md },
  logoutButton: {
    backgroundColor: colors.danger,
  },
  loadingBox: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
});
