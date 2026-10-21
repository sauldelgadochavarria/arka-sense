import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'auth_state.dart';

/// Marcación local pendiente de enviar al servidor.
class LocalPunch {
  LocalPunch({
    required this.localId,
    required this.tipoMarcacion,
    required this.timestamp,
    required this.pendingBody,
    this.lat,
    this.lng,
  });

  final String localId;
  final String tipoMarcacion;
  final DateTime timestamp;
  final Map<String, dynamic> pendingBody;
  final double? lat;
  final double? lng;

  Map<String, dynamic> toJson() => {
        'localId': localId,
        'tipoMarcacion': tipoMarcacion,
        'timestamp': timestamp.toIso8601String(),
        'pendingBody': pendingBody,
        'lat': lat,
        'lng': lng,
      };

  factory LocalPunch.fromJson(Map<String, dynamic> j) => LocalPunch(
        localId: '${j['localId']}',
        tipoMarcacion: '${j['tipoMarcacion']}',
        timestamp: DateTime.tryParse('${j['timestamp']}') ?? DateTime.now(),
        pendingBody: j['pendingBody'] is Map
            ? Map<String, dynamic>.from(j['pendingBody'] as Map)
            : <String, dynamic>{},
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
      );
}

class PunchLocalStore {
  PunchLocalStore._();
  static final PunchLocalStore instance = PunchLocalStore._();

  static const _pendingKey = 'aska_punch_pending_v1';
  static const _cacheKey = 'aska_punch_hist_cache_v1';

  List<LocalPunch> _pending = [];
  List<Map<String, dynamic>> _serverCache = [];
  bool _loaded = false;

  Future<void> ensureLoaded() async {
    if (_loaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      _pending = [];
      final rawP = prefs.getString(_pendingKey);
      if (rawP != null && rawP.isNotEmpty) {
        final decoded = jsonDecode(rawP);
        if (decoded is List) {
          for (final e in decoded) {
            if (e is Map) {
              _pending.add(LocalPunch.fromJson(Map<String, dynamic>.from(e)));
            }
          }
        }
      }
      _serverCache = [];
      final rawC = prefs.getString(_cacheKey);
      if (rawC != null && rawC.isNotEmpty) {
        final decoded = jsonDecode(rawC);
        if (decoded is List) {
          for (final e in decoded) {
            if (e is Map) {
              _serverCache.add(Map<String, dynamic>.from(e));
            }
          }
        }
      }
      _loaded = true;
    } catch (e) {
      debugPrint('[PunchLocalStore] load: $e');
      _loaded = true;
    }
  }

  Future<void> _persistPending() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _pendingKey,
      jsonEncode(_pending.map((e) => e.toJson()).toList()),
    );
  }

  Future<void> cacheServerRows(List<Map<String, dynamic>> rows) async {
    await ensureLoaded();
    _serverCache = rows.map((m) => Map<String, dynamic>.from(m)).toList();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cacheKey, jsonEncode(_serverCache));
  }

  Future<void> enqueuePending(LocalPunch punch) async {
    await ensureLoaded();
    _pending.insert(0, punch);
    await _persistPending();
  }

  int get pendingCount => _pending.length;

  /// Filas para UI: pendientes (no sync) + servidor/caché (sync).
  Future<List<Map<String, dynamic>>> mergedHistory() async {
    await ensureLoaded();
    final out = <Map<String, dynamic>>[];
    for (final p in _pending) {
      final body = p.pendingBody;
      out.add({
        'id': p.localId,
        'tipoMarcacion': p.tipoMarcacion,
        'timestamp': p.timestamp.toIso8601String(),
        'synced': false,
        'pending': true,
        'metodo': 'movil',
        'estado': 'pendiente_local',
        'ubicacion': (p.lat != null && p.lng != null)
            ? {
                'lat': p.lat,
                'lng': p.lng,
                'accuracyMeters': body['accuracyMeters'],
                'isMocked': body['isMocked'] == true,
              }
            : null,
        'dispositivo': {
          'plataforma': body['plataforma']?.toString() ?? '',
          'modelo': body['modelo']?.toString() ?? '',
          'appVersion': body['appVersion']?.toString() ?? '',
          'deviceUuid': body['deviceUuid']?.toString() ?? '',
        },
        'biometria': {
          'ok': body['biometriaOk'] == true,
          'score': body['biometriaScore'],
          'challengeId': body['biometriaChallengeId']?.toString() ?? '',
        },
      });
    }
    for (final m in _serverCache) {
      out.add({
        ...m,
        'synced': true,
        'pending': false,
      });
    }
    out.sort((a, b) {
      final ta = DateTime.tryParse('${a['timestamp']}') ?? DateTime(1970);
      final tb = DateTime.tryParse('${b['timestamp']}') ?? DateTime(1970);
      return tb.compareTo(ta);
    });
    return out;
  }

  /// Envía pendientes en orden cronológico (más antiguas primero).
  Future<int> flushPending(AuthState auth) async {
    await ensureLoaded();
    if (_pending.isEmpty) return 0;

    final ordered = List<LocalPunch>.from(_pending)
      ..sort((a, b) => a.timestamp.compareTo(b.timestamp));
    final remaining = <LocalPunch>[];
    var okCount = 0;

    for (final p in ordered) {
      try {
        await auth.api.post('/asistencia/marcar', p.pendingBody);
        okCount += 1;
      } on ApiException catch (e) {
        if (e.isSessionRevoked) rethrow;
        remaining.add(p);
        remaining.addAll(
          ordered.skipWhile((x) => x.localId != p.localId).skip(1),
        );
        break;
      } catch (e) {
        debugPrint('[PunchLocalStore] flush: $e');
        remaining.add(p);
        remaining.addAll(
          ordered.skipWhile((x) => x.localId != p.localId).skip(1),
        );
        break;
      }
    }

    _pending = remaining
      ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
    await _persistPending();
    return okCount;
  }
}
