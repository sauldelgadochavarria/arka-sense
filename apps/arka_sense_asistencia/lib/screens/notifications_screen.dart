import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../services/notification_inbox.dart';

/// Historial de notificaciones (últimos 2 meses).
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  List<AppNotification> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    await NotificationInbox.instance.ensureLoaded();
    if (!mounted) return;
    setState(() {
      _items = NotificationInbox.instance.all;
      _loading = false;
    });
  }

  Future<void> _open(AppNotification n) async {
    await NotificationInbox.instance.markRead(n.id);
    if (!mounted) return;
    setState(() => _items = NotificationInbox.instance.all);
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF12262C),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  n.urgente ? Icons.priority_high : Icons.mail_outline,
                  color: n.urgente ? Colors.redAccent : const Color(0xFF2FD4A1),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    n.title,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              DateFormat('dd/MM/yyyy HH:mm').format(n.createdAt.toLocal()),
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
            const SizedBox(height: 14),
            Text(n.body, style: const TextStyle(color: Colors.white70, height: 1.4)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1518),
      appBar: AppBar(
        title: const Text('Notificaciones'),
        backgroundColor: const Color(0xFF0D3A4A),
        actions: [
          if (_items.any((n) => !n.read))
            TextButton(
              onPressed: () async {
                await NotificationInbox.instance.markAllRead();
                await _load();
              },
              child: const Text('Marcar leídas'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? const Center(
                  child: Text(
                    'Sin notificaciones en los últimos 2 meses',
                    style: TextStyle(color: Colors.white54),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final n = _items[i];
                      final when = DateFormat('dd/MM/yy HH:mm').format(n.createdAt.toLocal());
                      return Material(
                        color: n.read ? const Color(0xFF12262C) : const Color(0xFF16353D),
                        borderRadius: BorderRadius.circular(12),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => _open(n),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.mail_outline,
                                  color: n.read ? Colors.white38 : const Color(0xFF2FD4A1),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              n.title,
                                              style: TextStyle(
                                                fontWeight:
                                                    n.read ? FontWeight.w500 : FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                          if (!n.read)
                                            Container(
                                              width: 8,
                                              height: 8,
                                              decoration: const BoxDecoration(
                                                color: Color(0xFF2FD4A1),
                                                shape: BoxShape.circle,
                                              ),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        n.body,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          color: Colors.white70,
                                          fontSize: 13,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        when,
                                        style: const TextStyle(
                                          color: Colors.white38,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
