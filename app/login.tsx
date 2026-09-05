/**
 * Login Screen
 * Đăng nhập vào multicam-server (API v1). Sau khi đăng nhập thành công,
 * token được lưu ở AsyncStorage và router tự chuyển về tab chính.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { colors, radius, spacing } from '../src/constants/theme';
import { getDeviceId } from '../src/utils/device';
import { login } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { serverConfigService } from '../src/services/serverConfig';
import { logger } from '../src/utils/logger';

export default function LoginScreen() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serverConfigService.load().then(config => {
      setHost(config.host);
      setPort(config.port);
    });
  }, []);

  const submittingRef = useRef(false);

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.logo}>🎥</Text>
        <Text style={styles.title}>Multi-Cam Recorder</Text>
        <Text style={styles.subtitle}>Đăng nhập để quay, upload và quản lý video</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Số điện thoại / Email</Text>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="VD: 0900000002"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!submitting}
        />

        <Text style={styles.label}>Mật khẩu</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          editable={!submitting}
          onSubmitEditing={handleSubmit}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.serverHeaderRow}>
          <TouchableOpacity
            onPress={() => setShowServer(!showServer)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.serverToggle}>
              {showServer ? '▾' : '▸'} Server: {host || '?'}:{port || '?'}
            </Text>
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
            <Text style={styles.serverHint}>
              Điện thoại cùng Wi-Fi với máy chạy server. IP sẽ được lưu cho lần đăng nhập sau.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}>
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Đăng nhập</Text>
          )}
        </TouchableOpacity>

        <View style={styles.hintBox}>
          <Text style={styles.hintTitle}>Tài khoản demo</Text>
          <Text style={styles.hintText}>Controller: 0900000001 / Controller@123</Text>
          <Text style={styles.hintText}>Remote: 0900000002..4 / Remote@123</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logo: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
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
  serverHeaderRow: {
    marginTop: spacing.lg,
  },
  serverToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
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
  serverHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 16,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  hintBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginBottom: spacing.xs,
  },
  hintText: {
    fontSize: 12,
    color: colors.primaryDark,
    lineHeight: 18,
  },
});
