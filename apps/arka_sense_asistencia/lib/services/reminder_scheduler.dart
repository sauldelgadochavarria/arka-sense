import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import 'api_client.dart';
import 'auth_state.dart';

/// Recordatorios de entrada/salida según horario asignado.
/// - Online: descarga /asistencia/horario y reprograma.
/// - Offline: usa caché local (últimos recordatorios sincronizados).
class ReminderScheduler {
  ReminderScheduler._();
  static final ReminderScheduler instance = ReminderScheduler._();

  static const _prefsKey = 'aska_reminders_cache_v1';
  static const _channelId = 'checada_horarios';
  static const _channelName = 'Recordatorios de checada';

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    tzdata.initializeTimeZones();
    // Mercado MX; el SO programa en hora local del dispositivo vía TZDateTime.from(..., tz.local)
    try {
      tz.setLocalLocation(tz.getLocation('America/Mexico_City'));
    } catch (_) {
      tz.setLocalLocation(tz.UTC);
    }

    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );

    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.requestNotificationsPermission();
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        _channelId,
        _channelName,
        description: 'Avisos de entrada y salida según tu turno',
        importance: Importance.high,
      ),
    );

    _ready = true;
  }

  /// Sync online si hay sesión; si falla, reprograma desde caché (offline).
  Future<ReminderSyncResult> syncFromApi(AuthState auth) async {
    await init();
    if (!auth.isAuthenticated) {
      await cancelAll();
      return ReminderSyncResult(ok: false, message: 'Sin sesión', scheduled: 0);
    }
    try {
      final data = await auth.api.get('/asistencia/horario?dias=7');
      await _persistCache(data);
      final n = await _scheduleFromPayload(data);
      return ReminderSyncResult(
        ok: true,
        message: 'Recordatorios actualizados',
        scheduled: n,
        online: true,
      );
    } catch (e) {
      final cached = await _loadCache();
      if (cached != null) {
        final n = await _scheduleFromPayload(cached);
        return ReminderSyncResult(
          ok: true,
          message: 'Sin red: recordatorios desde caché',
          scheduled: n,
          online: false,
          error: e.toString(),
        );
      }
      return ReminderSyncResult(
        ok: false,
        message: e is ApiException ? e.message : e.toString(),
        scheduled: 0,
        online: false,
      );
    }
  }

  /// Reprograma solo desde caché (arranque / boot / sin token fresco).
  Future<int> rescheduleFromCache() async {
    await init();
    final cached = await _loadCache();
    if (cached == null) return 0;
    return _scheduleFromPayload(cached);
  }

  Future<void> cancelAll() async {
    try {
      await init().timeout(const Duration(seconds: 3));
      await _plugin.cancelAll().timeout(const Duration(seconds: 3));
    } catch (e) {
      debugPrint('[ReminderScheduler.cancelAll] $e');
    }
  }

  Future<void> _persistCache(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, jsonEncode(data));
  }

  Future<Map<String, dynamic>?> _loadCache() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {}
    return null;
  }

  Future<int> _scheduleFromPayload(Map<String, dynamic> data) async {
    await _plugin.cancelAll();
    final list = (data['recordatorios'] as List?) ?? [];
    final now = DateTime.now();
    var count = 0;
    var notifId = 1000;

    for (final item in list) {
      if (item is! Map) continue;
      final atRaw = item['at']?.toString();
      if (atRaw == null || atRaw.isEmpty) continue;
      final at = DateTime.tryParse(atRaw)?.toLocal();
      if (at == null || !at.isAfter(now.add(const Duration(seconds: 30)))) {
        continue;
      }
      final titulo = item['titulo']?.toString() ?? 'Recordatorio de checada';
      final cuerpo = item['cuerpo']?.toString() ?? 'Es hora de registrar tu asistencia';
      final idKey = item['id']?.toString() ?? 'r-$notifId';
      final id = _stableId(idKey, notifId);
      notifId += 1;

      final tzWhen = tz.TZDateTime.from(at, tz.local);
      try {
        await _plugin.zonedSchedule(
          id,
          titulo,
          cuerpo,
          tzWhen,
          NotificationDetails(
            android: AndroidNotificationDetails(
              _channelId,
              _channelName,
              channelDescription: 'Avisos de entrada y salida según tu turno',
              importance: Importance.high,
              priority: Priority.high,
              icon: '@mipmap/ic_launcher',
            ),
            iOS: const DarwinNotificationDetails(),
          ),
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
          payload: idKey,
        );
        count += 1;
      } catch (e) {
        debugPrint('[reminders] schedule fail $idKey: $e');
      }
    }
    return count;
  }

  int _stableId(String key, int fallback) {
    var h = 0;
    for (final c in key.codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    if (h < 1) h = fallback;
    return h;
  }
}

class ReminderSyncResult {
  ReminderSyncResult({
    required this.ok,
    required this.message,
    required this.scheduled,
    this.online = true,
    this.error,
  });

  final bool ok;
  final String message;
  final int scheduled;
  final bool online;
  final String? error;
}
