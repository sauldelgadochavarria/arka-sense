import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({this.token});

  String? token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      Uri.parse('${ApiConfig.apiBase}$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await http.get(
      Uri.parse('${ApiConfig.apiBase}$path'),
      headers: _headers,
    );
    return _decode(res);
  }

  /// Multipart (biometría): no fija Content-Type JSON.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required Map<String, String> fields,
    required Map<String, List<int>> files,
  }) async {
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
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    return _decode(res, acceptSuccessFlag: true);
  }

  Map<String, dynamic> _decode(http.Response res, {bool acceptSuccessFlag = false}) {
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
      throw ApiException(
        (data['error'] as String?) ??
            (data['message'] as String?) ??
            'Error HTTP ${res.statusCode}',
        statusCode: res.statusCode,
      );
    }
    return data;
  }
}
