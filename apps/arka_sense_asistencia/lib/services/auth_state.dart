import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

class AuthState extends ChangeNotifier {
  AuthState({FlutterSecureStorage? storage, ApiClient? client})
      : _storage = storage ?? const FlutterSecureStorage(),
        _client = client ?? ApiClient();

  final FlutterSecureStorage _storage;
  final ApiClient _client;

  static const _kToken = 'aska_token';
  static const _kSession = 'aska_session';

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

  Future<void> login({
    required String account,
    required String email,
    required String password,
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
    _client.token = token;
    notifyListeners();
  }

  Future<void> logout() async {
    token = null;
    session = null;
    _client.token = null;
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kSession);
    notifyListeners();
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
