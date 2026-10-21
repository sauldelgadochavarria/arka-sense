import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';
import 'device_id_service.dart';
import 'location_service.dart';

class SavedCredentials {
  const SavedCredentials({
    required this.account,
    required this.email,
    this.password,
    this.rememberPassword = false,
  });

  final String account;
  final String email;
  final String? password;
  final bool rememberPassword;
}

class AuthState extends ChangeNotifier {
  AuthState({FlutterSecureStorage? storage, ApiClient? client})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            ),
        _client = client ?? ApiClient();

  final FlutterSecureStorage _storage;
  final ApiClient _client;

  static const _kToken = 'aska_token';
  static const _kSession = 'aska_session';
  static const _kAccount = 'aska_remember_account';
  static const _kEmail = 'aska_remember_email';
  static const _kPassword = 'aska_remember_password';
  static const _kRememberPassword = 'aska_remember_password_flag';
  static const _storageTimeout = Duration(seconds: 4);

  bool loading = true;
  String? token;
  Map<String, dynamic>? session;
  String? bootstrapError;
  String? sessionEndedMessage;

  bool get isAuthenticated => token != null && token!.isNotEmpty;

  Map<String, dynamic>? get seguridadMovil {
    final s = session?['seguridadMovil'];
    if (s is Map<String, dynamic>) return s;
    if (s is Map) return Map<String, dynamic>.from(s);
    return null;
  }

  /// Subsidiaria exige SMS+UUID y este teléfono aún no está vinculado.
  bool get needsDeviceRegistration {
    final s = seguridadMovil;
    if (s == null) return false;
    return s['exigirRegistroDispositivo'] == true && s['dispositivoRegistrado'] != true;
  }

  Map<String, dynamic>? get capabilities {
    final c = session?['capabilities'];
    if (c is Map<String, dynamic>) return c;
    if (c is Map) return Map<String, dynamic>.from(c);
    return null;
  }

  Map<String, dynamic>? get featureFlags {
    final f = session?['featureFlags'];
    if (f is Map<String, dynamic>) return f;
    if (f is Map) return Map<String, dynamic>.from(f);
    return null;
  }

  bool get vacacionesEnabled => featureFlags?['vacaciones'] == true;
  bool get recibosEnabled => featureFlags?['recibos'] == true;
  bool get esSupervisor => capabilities?['esSupervisor'] == true;

  final _deviceIds = DeviceIdService();

  ApiClient get api {
    _client.token = token;
    _client.onAuthFailure = _handleAuthFailure;
    return _client;
  }

  Future<void> _handleAuthFailure(ApiException error) async {
    if (!isAuthenticated) return;
    sessionEndedMessage = error.message.isNotEmpty
        ? error.message
        : 'Tu acceso fue revocado. Contacta a RRHH.';
    // No esperar cancelación de notificaciones: debe salir de inmediato.
    await logout(keepEndedMessage: true);
  }

  Future<String?> _readSafe(String key) async {
    try {
      return await _storage.read(key: key).timeout(_storageTimeout);
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeSafe(String key, String? value) async {
    try {
      if (value == null) {
        await _storage.delete(key: key).timeout(_storageTimeout);
      } else {
        await _storage.write(key: key, value: value).timeout(_storageTimeout);
      }
    } catch (_) {
      /* no bloquear UI */
    }
  }

  Future<void> bootstrap() async {
    loading = true;
    bootstrapError = null;
    notifyListeners();
    try {
      token = await _readSafe(_kToken);
      final raw = await _readSafe(_kSession);
      if (raw != null) {
        try {
          session = jsonDecode(raw) as Map<String, dynamic>;
        } catch (_) {
          session = null;
        }
      }
      _client.token = token;
      _client.onAuthFailure = _handleAuthFailure;
      if (token != null && token!.isNotEmpty) {
        try {
          final uuid = await _deviceIds.getDeviceUuid();
          final me = await api.get('/me?deviceUuid=${Uri.encodeQueryComponent(uuid)}');
          session = {
            ...?session,
            if (me['seguridadMovil'] is Map)
              'seguridadMovil': Map<String, dynamic>.from(me['seguridadMovil'] as Map),
            if (me['capabilities'] is Map)
              'capabilities': Map<String, dynamic>.from(me['capabilities'] as Map),
            if (me['featureFlags'] is Map)
              'featureFlags': Map<String, dynamic>.from(me['featureFlags'] as Map),
          };
          await _writeSafe(_kSession, jsonEncode(session));
        } on ApiException catch (e) {
          if (e.isSessionRevoked) {
            sessionEndedMessage = e.message;
          } else {
            bootstrapError = e.message;
          }
          token = null;
          session = null;
          _client.token = null;
          await _writeSafe(_kToken, null);
          await _writeSafe(_kSession, null);
        } catch (e) {
          // API inalcanzable → ir a login, no spinner eterno
          bootstrapError = e.toString();
          token = null;
          session = null;
          _client.token = null;
          await _writeSafe(_kToken, null);
          await _writeSafe(_kSession, null);
        }
      }
    } catch (e) {
      bootstrapError = e.toString();
      token = null;
      session = null;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Credenciales para precargar el formulario (tras logout o primer uso).
  Future<SavedCredentials?> loadSavedCredentials() async {
    final account = await _readSafe(_kAccount);
    final email = await _readSafe(_kEmail);
    if ((account == null || account.isEmpty) && (email == null || email.isEmpty)) {
      return null;
    }
    final rememberFlag = await _readSafe(_kRememberPassword);
    final rememberPassword = rememberFlag == '1';
    String? password;
    if (rememberPassword) {
      password = await _readSafe(_kPassword);
    }
    return SavedCredentials(
      account: account ?? '',
      email: email ?? '',
      password: password,
      rememberPassword: rememberPassword,
    );
  }

  Future<void> _persistLoginHints({
    required String account,
    required String email,
    required String password,
    required bool rememberPassword,
  }) async {
    await _writeSafe(_kAccount, account.trim());
    await _writeSafe(_kEmail, email.trim());
    await _writeSafe(_kRememberPassword, rememberPassword ? '1' : '0');
    if (rememberPassword) {
      await _writeSafe(_kPassword, password);
    } else {
      await _writeSafe(_kPassword, null);
    }
  }

  Future<void> login({
    required String account,
    required String email,
    required String password,
    bool rememberPassword = false,
  }) async {
    final uuid = await _deviceIds.getDeviceUuid();
    final data = await ApiClient().post('/auth/login', {
      'account': account.trim(),
      'email': email.trim(),
      'password': password,
      'deviceUuid': uuid,
      ...LocationService.deviceMeta(deviceUuid: uuid),
    });
    token = data['token'] as String?;
    session = {
      'user': data['user'],
      'empleado': data['empleado'],
      'tenant': data['tenant'],
      if (data['seguridadMovil'] is Map)
        'seguridadMovil': Map<String, dynamic>.from(data['seguridadMovil'] as Map),
      if (data['capabilities'] is Map)
        'capabilities': Map<String, dynamic>.from(data['capabilities'] as Map),
      if (data['featureFlags'] is Map)
        'featureFlags': Map<String, dynamic>.from(data['featureFlags'] as Map),
    };
    await _writeSafe(_kToken, token);
    await _writeSafe(_kSession, jsonEncode(session));
    await _persistLoginHints(
      account: account,
      email: email,
      password: password,
      rememberPassword: rememberPassword,
    );
    _client.token = token;
    _client.onAuthFailure = _handleAuthFailure;
    bootstrapError = null;
    sessionEndedMessage = null;
    notifyListeners();
  }

  Future<void> refreshSeguridadMovil() async {
    if (!isAuthenticated) return;
    final uuid = await _deviceIds.getDeviceUuid();
    final me = await api.get('/me?deviceUuid=${Uri.encodeQueryComponent(uuid)}');
    session = {
      ...?session,
      if (me['seguridadMovil'] is Map)
        'seguridadMovil': Map<String, dynamic>.from(me['seguridadMovil'] as Map),
      if (me['capabilities'] is Map)
        'capabilities': Map<String, dynamic>.from(me['capabilities'] as Map),
      if (me['featureFlags'] is Map)
        'featureFlags': Map<String, dynamic>.from(me['featureFlags'] as Map),
    };
    await _writeSafe(_kSession, jsonEncode(session));
    notifyListeners();
  }

  Future<void> refreshCapabilities() => refreshSeguridadMovil();

  /// Cierra sesión JWT; conserva cuenta/email (y contraseña si estaba marcada).
  Future<void> logout({bool keepEndedMessage = false}) async {
    token = null;
    session = null;
    _client.token = null;
    _client.onAuthFailure = null;
    if (!keepEndedMessage) sessionEndedMessage = null;
    // Notificar UI de inmediato; el storage puede ir después.
    notifyListeners();
    await _writeSafe(_kToken, null);
    await _writeSafe(_kSession, null);
  }

  void clearSessionEndedMessage() {
    if (sessionEndedMessage == null) return;
    sessionEndedMessage = null;
    notifyListeners();
  }

  /// Olvida también las credenciales guardadas (útil desde ajustes futuros).
  Future<void> clearSavedCredentials() async {
    await _writeSafe(_kAccount, null);
    await _writeSafe(_kEmail, null);
    await _writeSafe(_kPassword, null);
    await _writeSafe(_kRememberPassword, null);
  }

  String get displayName {
    final emp = session?['empleado'] as Map<String, dynamic>?;
    final user = session?['user'] as Map<String, dynamic>?;
    return (emp?['nombre'] as String?)?.trim().isNotEmpty == true
        ? emp!['nombre'] as String
        : (user?['name'] as String?) ?? 'Empleado';
  }

  String get numEmpleado {
    final emp = session?['empleado'] as Map<String, dynamic>?;
    return (emp?['numEmpleado'] as String?) ?? '';
  }

  String get tenantLabel {
    final t = session?['tenant'] as Map<String, dynamic>?;
    return (t?['displayName'] as String?) ?? (t?['slug'] as String?) ?? '';
  }

  String get tenantSlug {
    final t = session?['tenant'] as Map<String, dynamic>?;
    return (t?['slug'] as String?) ?? '';
  }

  String get userEmail {
    final user = session?['user'] as Map<String, dynamic>?;
    return (user?['email'] as String?) ?? '';
  }
}
