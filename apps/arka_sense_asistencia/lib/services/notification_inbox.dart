import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Bandeja local de notificaciones (alertas 1:1 / avisos).
/// Conserva 2 meses; las más antiguas se eliminan al cargar o al agregar.
class AppNotification {
  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    this.read = false,
    this.urgente = false,
    this.type = 'aviso',
  });

  final String id;
  final String title;
  final String body;
  final DateTime createdAt;
  bool read;
  final bool urgente;
  final String type;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'body': body,
        'createdAt': createdAt.toIso8601String(),
        'read': read,
        'urgente': urgente,
        'type': type,
      };

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: '${j['id']}',
        title: '${j['title'] ?? ''}',
        body: '${j['body'] ?? ''}',
        createdAt: DateTime.tryParse('${j['createdAt']}') ?? DateTime.now(),
        read: j['read'] == true,
        urgente: j['urgente'] == true,
        type: '${j['type'] ?? 'aviso'}',
      );
}

class NotificationInbox {
  NotificationInbox._();
  static final NotificationInbox instance = NotificationInbox._();

  static const _prefsKey = 'aska_notif_inbox_v1';
  static const retention = Duration(days: 60);

  final List<AppNotification> _items = [];
  bool _loaded = false;
  VoidCallback? onChanged;

  int get unreadCount => _items.where((n) => !n.read).length;

  List<AppNotification> get all => List.unmodifiable(_items);

  /// Últimas N (más recientes primero) — para el carrusel del home.
  List<AppNotification> latest({int limit = 2}) =>
      _items.take(limit.clamp(0, _items.length)).toList();

  Future<void> ensureLoaded() async {
    if (_loaded) return;
    await _load();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefsKey);
      _items.clear();
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          for (final e in decoded) {
            if (e is Map) {
              _items.add(AppNotification.fromJson(Map<String, dynamic>.from(e)));
            }
          }
        }
      }
      _pruneInMemory();
      if (_items.isEmpty) {
        await _seedDefaults();
      }
      _loaded = true;
      await _persist();
    } catch (e) {
      debugPrint('[NotificationInbox] load: $e');
      _loaded = true;
    }
  }

  Future<void> _seedDefaults() async {
    final now = DateTime.now();
    _items.addAll([
      AppNotification(
        id: 'seed-welcome',
        title: 'Bienvenido a ArkaSense',
        body: 'Usa el botón grande para registrar entrada y salida con biometría.',
        createdAt: now.subtract(const Duration(minutes: 2)),
        type: 'aviso',
      ),
      AppNotification(
        id: 'seed-reminders',
        title: 'Recordatorios de turno',
        body: 'Te avisaremos minutos antes de tu entrada y salida (incluso offline).',
        createdAt: now.subtract(const Duration(minutes: 1)),
        type: 'aviso',
      ),
    ]);
    _sort();
  }

  void _pruneInMemory() {
    final cutoff = DateTime.now().subtract(retention);
    _items.removeWhere((n) => n.createdAt.isBefore(cutoff));
    _sort();
  }

  void _sort() {
    _items.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Future<void> _persist() async {
    _pruneInMemory();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _prefsKey,
      jsonEncode(_items.map((e) => e.toJson()).toList()),
    );
    onChanged?.call();
  }

  Future<void> add({
    required String title,
    required String body,
    bool urgente = false,
    String type = 'alerta',
    String? id,
  }) async {
    await ensureLoaded();
    final nid = id ?? 'n-${DateTime.now().millisecondsSinceEpoch}';
    _items.removeWhere((n) => n.id == nid);
    _items.insert(
      0,
      AppNotification(
        id: nid,
        title: title,
        body: body,
        createdAt: DateTime.now(),
        urgente: urgente,
        type: type,
      ),
    );
    await _persist();
  }

  Future<void> markRead(String id) async {
    await ensureLoaded();
    final n = _items.cast<AppNotification?>().firstWhere(
          (e) => e?.id == id,
          orElse: () => null,
        );
    if (n == null || n.read) return;
    n.read = true;
    await _persist();
  }

  Future<void> markAllRead() async {
    await ensureLoaded();
    var changed = false;
    for (final n in _items) {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) await _persist();
  }
}
