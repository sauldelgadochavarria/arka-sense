import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';

class DownloadedFile {
  DownloadedFile({required this.bytes, required this.filename, required this.contentType});
  final List<int> bytes;
  final String filename;
  final String contentType;
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.reasonCode});
  final String message;
  final int? statusCode;
  final String? reasonCode;

  bool get isSessionRevoked {
    // Un rostro que no coincide no debe cerrar la sesión.
    const authCodes = {
      'TOKEN_REQUIRED',
      'TOKEN_INVALID',
      'TOKEN_INCOMPLETE',
      'SESSION_REVOKED',
      'EMPLEADO_BAJA',
      'USER_INACTIVE',
      'TENANT_MISMATCH',
      'UNAUTHORIZED',
    };
    if (statusCode == 401) {
      return reasonCode == null || authCodes.contains(reasonCode);
    }
    if (statusCode != 403) return false;
    const codes = {
      'SESSION_REVOKED',
      'EMPLEADO_BAJA',
      'USER_INACTIVE',
      'TOKEN_INVALID',
      'TOKEN_INCOMPLETE',
      'TENANT_MISMATCH',
    };
    return reasonCode != null && codes.contains(reasonCode);
  }

  @override
  String toString() => message;
}

typedef AuthFailureHandler = Future<void> Function(ApiException error);

class ApiClient {
  ApiClient({this.token, this.timeout = const Duration(seconds: 12)});

  String? token;
  final Duration timeout;
  AuthFailureHandler? onAuthFailure;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  Future<T> _withTimeout<T>(Future<T> future) => future.timeout(
        timeout,
        onTimeout: () => throw ApiException(
          'Tiempo de espera agotado al contactar ${ApiConfig.baseUrl}. '
          'Revisa Wi‑Fi y que el SaaS esté en esa IP:4003.',
        ),
      );

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    try {
      final res = await _withTimeout(http.post(
        Uri.parse('${ApiConfig.apiBase}$path'),
        headers: _headers,
        body: jsonEncode(body),
      ));
      return await _decode(res);
    } on SocketException catch (e) {
      throw ApiException(
        'Sin conexión a ${ApiConfig.baseUrl} (${e.message}). '
        'En el teléfono usa la IP LAN del PC, no 127.0.0.1.',
      );
    } on TimeoutException {
      throw ApiException('Tiempo de espera agotado (${ApiConfig.baseUrl}).');
    }
  }

  /// Descarga binaria (PDF/XML). Timeout más amplio que el JSON habitual.
  Future<DownloadedFile> download(String path) async {
    try {
      final res = await http
          .get(
            Uri.parse('${ApiConfig.apiBase}$path'),
            headers: {
              'Accept': '*/*',
              if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 45));
      if (res.statusCode >= 400) {
        await _decode(res);
      }
      final cd = res.headers['content-disposition'] ?? '';
      final match = RegExp('filename="?([^";]+)').firstMatch(cd);
      final name = Uri.decodeComponent((match?.group(1) ?? 'archivo').trim());
      return DownloadedFile(
        bytes: res.bodyBytes,
        filename: name.isEmpty ? 'archivo' : name,
        contentType: res.headers['content-type'] ?? 'application/octet-stream',
      );
    } on ApiException {
      rethrow;
    } on SocketException catch (e) {
      throw ApiException('Sin conexión a ${ApiConfig.baseUrl} (${e.message}).');
    } on TimeoutException {
      throw ApiException('Tiempo de espera agotado al descargar (${ApiConfig.baseUrl}).');
    }
  }

  Future<Map<String, dynamic>> get(String path) async {
    try {
      final res = await _withTimeout(http.get(
        Uri.parse('${ApiConfig.apiBase}$path'),
        headers: _headers,
      ));
      return await _decode(res);
    } on SocketException catch (e) {
      throw ApiException(
        'Sin conexión a ${ApiConfig.baseUrl} (${e.message}).',
      );
    } on TimeoutException {
      throw ApiException('Tiempo de espera agotado (${ApiConfig.baseUrl}).');
    }
  }

  /// Multipart (biometría): no fija Content-Type JSON.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required Map<String, String> fields,
    required Map<String, List<int>> files,
  }) async {
    try {
      final uri = Uri.parse('${ApiConfig.apiBase}$path');
      final req = http.MultipartRequest('POST', uri);
      req.headers['Accept'] = 'application/json';
      if (token != null && token!.isNotEmpty) {
        req.headers['Authorization'] = 'Bearer $token';
      }
      req.fields.addAll(fields);
      files.forEach((name, bytes) {
        req.files.add(http.MultipartFile.fromBytes(name, bytes, filename: '$name.jpg'));
      });
      final streamed = await _withTimeout(req.send());
      final res = await http.Response.fromStream(streamed);
      return await _decode(res, acceptSuccessFlag: true);
    } on SocketException catch (e) {
      throw ApiException('Sin conexión a ${ApiConfig.baseUrl} (${e.message}).');
    } on TimeoutException {
      throw ApiException('Tiempo de espera agotado (${ApiConfig.baseUrl}).');
    }
  }

  Future<Map<String, dynamic>> _decode(http.Response res, {bool acceptSuccessFlag = false}) async {
    Map<String, dynamic> data = {};
    try {
      final decoded = jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {
      /* ignore */
    }
    final failed = res.statusCode >= 400 ||
        data['ok'] == false ||
        (acceptSuccessFlag && data['success'] == false);
    if (failed) {
      final ex = ApiException(
        (data['error'] as String?) ??
            (data['message'] as String?) ??
            'Error HTTP ${res.statusCode}',
        statusCode: res.statusCode,
        reasonCode: data['code'] as String?,
      );
      if (ex.isSessionRevoked && onAuthFailure != null) {
        try {
          await onAuthFailure!(ex);
        } catch (_) {
          /* ignore */
        }
      }
      throw ex;
    }
    return data;
  }
}
