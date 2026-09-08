import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

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
      : _storage = storage ?? const FlutterSecureStorage(),
        _client = client ?? ApiClient();

  final FlutterSecureStorage _storage;
  final ApiClient _client;

  static const _kToken = 'aska_token';
  static const _kSession = 'aska_session';
  static const _kAccount = 'aska_remember_account';
  static const _kEmail = 'aska_remember_email';
  static const _kPassword = 'aska_remember_password';
  static const _kRememberPassword = 'aska_remember_password_flag';

  bool loading = true;
  String? token;
  Map<String, dynamic>? session;

  bool get isAuthenticated => token != null && token!.isNotEmpty;

  ApiClient get api {
    _client.token = token;
    return _client;
  }

  Future<void> bootstrap() async {
    loading = true;
    notifyListeners();
    token = await _storage.read(key: _kToken);
    final raw = await _storage.read(key: _kSession);
    if (raw != null) {
      try {
        session = jsonDecode(raw) as Map<String, dynamic>;
      } catch (_) {
        session = null;
      }
    }
    _client.token = token;
    if (token != null) {
      try {
        await api.get('/me');
      } catch (_) {
        await logout();
      }
    }
    loading = false;
    notifyListeners();
  }

  /// Credenciales para precargar el formulario (tras logout o primer uso).
  Future<SavedCredentials?> loadSavedCredentials() async {
    final account = await _storage.read(key: _kAccount);
    final email = await _storage.read(key: _kEmail);
    if ((account == null || account.isEmpty) && (email == null || email.isEmpty)) {
      return null;
    }
    final rememberFlag = await _storage.read(key: _kRememberPassword);
    final rememberPassword = rememberFlag == '1';
    String? password;
    if (rememberPassword) {
      password = await _storage.read(key: _kPassword);
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
    await _storage.write(key: _kAccount, value: account.trim());
    await _storage.write(key: _kEmail, value: email.trim());
    await _storage.write(key: _kRememberPassword, value: rememberPassword ? '1' : '0');
    if (rememberPassword) {
      await _storage.write(key: _kPassword, value: password);
    } else {
      await _storage.delete(key: _kPassword);
    }
  }

  Future<void> login({
    required String account,
    required String email,
    required String password,
    bool rememberPassword = false,
  }) async {
    final data = await ApiClient().post('/auth/login', {
      'account': account.trim(),
      'email': email.trim(),
      'password': password,
    });
    token = data['token'] as String?;
    session = {
      'user': data['user'],
      'empleado': data['empleado'],
      'tenant': data['tenant'],
    };
    await _storage.write(key: _kToken, value: token);
    await _storage.write(key: _kSession, value: jsonEncode(session));
    await _persistLoginHints(
      account: account,
      email: email,
      password: password,
      rememberPassword: rememberPassword,
    );
    _client.token = token;
    notifyListeners();
  }

  /// Cierra sesión JWT; conserva cuenta/email (y contraseña si estaba marcada).
  Future<void> logout() async {
    token = null;
    session = null;
    _client.token = null;
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kSession);
    notifyListeners();
  }

  /// Olvida también las credenciales guardadas (útil desde ajustes futuros).
  Future<void> clearSavedCredentials() async {
    await _storage.delete(key: _kAccount);
    await _storage.delete(key: _kEmail);
    await _storage.delete(key: _kPassword);
    await _storage.delete(key: _kRememberPassword);
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
}
