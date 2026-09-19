/**
 * Login Screen
 * Đăng nhập vào multicam-server (API v1). Sau khi đăng nhập thành công,
 * token được lưu ở AsyncStorage và router tự chuyển về tab chính.
 * Luồng LAN: quét server → thấy phòng chung → tap "Vào phòng" → đăng nhập
 * là Remote tự join phòng (không cần gõ mã mời).
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../src/constants/theme';
import { getDeviceId } from '../src/utils/device';
import { login } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { serverConfigService } from '../src/services/serverConfig';
import { discoverServers, refreshRooms, DiscoveredServer } from '../src/services/discovery';
import { logger } from '../src/utils/logger';

export default function LoginScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [foundServers, setFoundServers] = useState<DiscoveredServer[] | null>(null);
  const [showDemos, setShowDemos] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    serverConfigService.load().then(config => {
      setHost(config.host);
      setPort(config.port);
    });
  }, []);

  const submittingRef = useRef(false);
  // Danh sách server mới nhất (dùng cho poll phòng) — tránh closure cũ ghi đè
  // kết quả khi người dùng bấm "Quét" lại trong lúc tick đang chạy.
  const serversRef = useRef<DiscoveredServer[] | null>(null);

  // Làm tươi danh sách phòng (phòng mới tạo sau scan sẽ hiện lên ngay).
  // Đọc từ ref nên không bao giờ trả về kết quả cũ ghi đè một cuộc scan mới.
  useEffect(() => {
    const id = setInterval(async () => {
      const current = serversRef.current;
      if (!current || current.length === 0) return;
      const updated = await refreshRooms(current).catch(() => current);
      if (serversRef.current !== current) return; // đã có scan/pick mới — bỏ kết quả cũ
      serversRef.current = updated;
      setFoundServers(updated);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  const handleScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setFoundServers(null);
    serversRef.current = null;
    setError(null);
    setSuccess(null);
    try {
      const servers = await discoverServers(5000);
      serversRef.current = servers.length ? servers : null;
      setFoundServers(servers);
      if (servers.length === 0) {
        setError(
          'Không tìm thấy server trên LAN. Kiểm tra cùng wifi / server đang chạy, hoặc nhập IP thủ công.',
        );
      }
    } catch (err) {
      logger.error('Scan failed', err);
      setError('Quét lỗi — cần dev build có react-native-zeroconf.');
    } finally {
      setIsScanning(false);
    }
  };

  const handlePickServer = (s: DiscoveredServer) => {
    const ip = s.host || s.addresses[0] || '';
    if (!ip) return;
    setHost(ip);
    setPort(String(s.port || 3000));
    serverConfigService.clearLanRoom();
    serversRef.current = null;
    setFoundServers(null);
    setError(null);
    setSuccess(`Đã chọn server ${ip}:${s.port}. Bấm "Đăng nhập" để tiếp tục.`);
  };

  const handlePickRoom = async (s: DiscoveredServer, room: any) => {
    const ip = s.host || s.addresses[0] || '';
    if (!ip || !room?.invite_code) return;
    setHost(ip);
    setPort(String(s.port || 3000));
    await serverConfigService.save(ip, String(s.port || 3000));
    await serverConfigService.saveLanRoom({
      room_id: room.room_id ?? null,
      room_name: room.room_name ?? null,
      invite_code: room.invite_code,
      auto_approve: room.auto_approve ?? 1,
    });
    serversRef.current = null;
    setFoundServers(null);
    setError(null);
    setSuccess(`Đã chọn phòng "${room.room_name || 'LAN'}". Đăng nhập là Remote để vào phòng.`);
    setShowServer(false);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!identifier.trim() || !password) {
      setError('Vui lòng nhập tài khoản và mật khẩu.');
      return;
    }
    if (!host.trim() || !port.trim()) {
      setError('Vui lòng nhập địa chỉ IP và port của server.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      await serverConfigService.save(host.trim(), port.trim());
      const deviceId = await getDeviceId();
      await login({
        identifier: identifier.trim(),
        password,
        deviceId,
        deviceType: Platform.OS === 'ios' ? 2 : 1,
        deviceName:
          (Constants as any).deviceName ||
          `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} của tôi`,
      });
      router.replace('/(tabs)');
    } catch (err: any) {
      logger.warn('Login failed', err);
      const message =
        err instanceof ApiError
          ? err.code === 9995
            ? 'Số điện thoại/email hoặc mật khẩu không đúng.'
            : err.code === -1
              ? 'Không kết nối được server. Kiểm tra lại IP/port phía dưới.'
              : err.message
          : 'Đăng nhập thất bại. Vui lòng thử lại.';
      setError(message);
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const serverTarget = host.trim() ? `${host.trim()}:${port.trim() || '?'}` : 'Chưa cấu hình';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logo}>🎥</Text>
            </View>
            <Text style={styles.title}>Multi-Cam Recorder</Text>
            <Text style={styles.subtitle}>Quay, upload và quản lý video</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Số điện thoại / Email</Text>
            <TextInput
              style={styles.input}
              value={identifier}
              onChangeText={value => {
                setIdentifier(value);
                setError(null);
              }}
              placeholder="VD: 0900000002"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              keyboardType="email-address"
              returnKeyType="next"
              editable={!submitting}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <Text style={styles.label}>Mật khẩu</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                ref={passwordRef}
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={value => {
                  setPassword(value);
                  setError(null);
                }}
                placeholder="Nhập mật khẩu"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                returnKeyType="done"
                editable={!submitting}
                onSubmitEditing={handleSubmit}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(v => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            {success && (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{success}</Text>
              </View>
            )}

            <View style={styles.serverHeaderRow}>
              <TouchableOpacity
                style={styles.serverToggleRow}
                onPress={() => setShowServer(v => !v)}
                activeOpacity={0.7}>
                <View style={styles.serverToggleLeft}>
                  <Text
                    style={[styles.serverToggleIcon, showServer ? styles.serverToggleOpen : null]}>
                    ▸
                  </Text>
                  <Text style={styles.serverToggleLabel}>Kết nối server</Text>
                </View>
                <View style={styles.serverChip}>
                  <Text style={styles.serverChipText} numberOfLines={1}>
                    {serverTarget}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {showServer && (
              <View style={styles.serverBox}>
                <View style={styles.serverRow}>
                  <View style={styles.hostWrap}>
                    <Text style={styles.label}>Địa chỉ IP server</Text>
                    <TextInput
                      style={styles.input}
                      value={host}
                      onChangeText={setHost}
                      placeholder="VD: 192.168.1.101"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      editable={!submitting}
                    />
                  </View>
                  <View style={styles.portWrap}>
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
                      editable={!submitting}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.scanButton, isScanning && styles.buttonDisabled]}
                  onPress={handleScan}
                  disabled={isScanning}>
                  {isScanning ? (
                    <View style={styles.scanButtonInner}>
                      <ActivityIndicator color={colors.white} size="small" />
                      <Text style={styles.scanButtonText}>Đang quét mạng…</Text>
                    </View>
                  ) : (
                    <Text style={styles.scanButtonText}>🔎 Quét server & phòng LAN</Text>
                  )}
                </TouchableOpacity>

                {isScanning && (
                  <Text style={styles.scanNote}>
                    Quét mDNS + rà subnet /24. Vài giây để có kết quả.
                  </Text>
                )}

                {!isScanning && foundServers && foundServers.length === 0 && (
                  <View style={styles.scanEmpty}>
                    <Text style={styles.scanNoRoom}>
                      Không có server nào. Bạn có thể nhập IP thủ công ở trên.
                    </Text>
                  </View>
                )}

                {foundServers && foundServers.length > 0 && (
                  <View style={styles.scanResults}>
                    {foundServers.map(s => {
                      const ip = s.host || s.addresses[0] || '';
                      const label = s.txt?.server_name || s.name || `${ip}:${s.port}`;
                      const rooms = s.rooms || [];
                      return (
                        <View key={`${ip}:${s.port}`} style={styles.scanServerCard}>
                          <TouchableOpacity
                            style={styles.scanItem}
                            onPress={() => handlePickServer(s)}
                            activeOpacity={0.7}>
                            <View style={styles.scanServerDot} />
                            <View style={styles.flex}>
                              <Text style={styles.scanItemName}>{label}</Text>
                              <Text style={styles.scanItemSub}>
                                {ip}:{s.port}
                              </Text>
                            </View>
                            <Text style={styles.scanItemPick}>Chọn ›</Text>
                          </TouchableOpacity>

                          {rooms.map(r => (
                            <TouchableOpacity
                              key={r.room_id ?? r.invite_code}
                              style={styles.scanRoomItem}
                              onPress={() => handlePickRoom(s, r)}
                              activeOpacity={0.7}>
                              <View style={styles.flex}>
                                <Text style={styles.scanRoomName}>
                                  📡 {r.room_name || 'Phòng LAN'}
                                </Text>
                                <Text style={styles.scanRoomSub}>
                                  {r.auto_approve === 0
                                    ? 'Cần Controller duyệt'
                                    : 'Tự động vào phòng'}{' '}
                                  · {r.member_count ?? 0} thiết bị · mã {r.invite_code}
                                </Text>
                              </View>
                              <Text style={styles.scanItemPick}>Vào phòng ›</Text>
                            </TouchableOpacity>
                          ))}
                          {rooms.length === 0 && (
                            <Text style={styles.scanNoRoom}>
                              Không có phòng nào đang mở trên LAN
                            </Text>
                          )}
                        </View>
                      );
                    })}
                    <Text style={styles.scanNote}>
                      Tap {'"Vào phòng"'} → đăng nhập là Remote tự vào phòng, không cần gõ mã mời.
                    </Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}>
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>Đăng nhập</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.demoToggle} onPress={() => setShowDemos(v => !v)}>
            <Text style={styles.demoToggleText}>{showDemos ? '▾' : '▸'} Tài khoản demo</Text>
          </TouchableOpacity>
          {showDemos && (
            <View style={styles.hintBox}>
              <Text style={styles.hintLine}>Controller: 0900000001 / Controller@123</Text>
              <Text style={styles.hintLine}>Remote: 0900000002..4 / Remote@123</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  logo: {
    fontSize: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
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
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingRight: spacing.xl * 1.5,
  },
  eyeButton: {
    position: 'absolute',
    right: spacing.md,
    padding: spacing.xs,
  },
  eyeIcon: {
    fontSize: 16,
  },
  errorBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: {
    color: colors.dangerDark,
    fontSize: 13,
    fontWeight: '600',
  },
  successBox: {
    backgroundColor: colors.successLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  successText: {
    color: colors.successDark,
    fontSize: 13,
    fontWeight: '600',
  },
  serverHeaderRow: {
    marginTop: spacing.lg,
  },
  serverToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  serverToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  serverToggleIcon: {
    fontSize: 14,
    color: colors.textMuted,
    transform: [{ rotate: '90deg' }],
  },
  serverToggleOpen: {
    transform: [{ rotate: '90deg' }],
    color: colors.primary,
  },
  serverToggleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  serverChip: {
    maxWidth: '55%',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.round,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  serverChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  serverBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  serverRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  hostWrap: {
    flex: 2,
  },
  portWrap: {
    flex: 1,
  },
  scanButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  scanButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  scanNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  scanEmpty: {
    marginTop: spacing.sm,
  },
  scanResults: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  scanServerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  scanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanServerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.round,
    backgroundColor: colors.success,
  },
  scanItemName: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  scanItemSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  scanItemPick: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  scanRoomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  scanRoomName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  scanRoomSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  scanNoRoom: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  demoToggle: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    padding: spacing.sm,
  },
  demoToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  hintBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintLine: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
