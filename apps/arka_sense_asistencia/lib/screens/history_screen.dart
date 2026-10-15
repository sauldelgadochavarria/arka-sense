import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';
import '../services/punch_local_store.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  bool _loading = true;
  bool _offline = false;
  String? _error;
  List<Map<String, dynamic>> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  String _labelTipo(String value) {
    const map = {
      'entrada': 'Entrada',
      'salida': 'Salida',
      'salida_comida': 'Salida a comida',
      'regreso_comida': 'Regreso de comida',
    };
    return map[value] ?? value;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final auth = context.read<AuthState>();
    final store = PunchLocalStore.instance;

    try {
      await store.flushPending(auth);
    } catch (_) {
      /* red / sesión */
    }

    try {
      final data = await auth.api.get('/asistencia/historial?dias=60');
      final raw = (data['marcaciones'] as List?) ?? [];
      final rows = raw
          .whereType<Map>()
          .map((m) => Map<String, dynamic>.from(m))
          .toList();
      await store.cacheServerRows(rows);
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = merged;
        _offline = false;
      });
    } on ApiException catch (e) {
      if (e.isSessionRevoked) return;
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = merged;
        _offline = true;
        _error = merged.isEmpty ? e.message : null;
      });
    } catch (e) {
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = merged;
        _offline = true;
        _error = merged.isEmpty ? e.toString() : null;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _rows.where((r) => r['synced'] != true).length;
    return Scaffold(
      backgroundColor: const Color(0xFF0A1518),
      appBar: AppBar(
        title: const Text('Historial'),
        backgroundColor: const Color(0xFF0D3A4A),
        automaticallyImplyLeading: false,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _rows.isEmpty
              ? Center(child: Text(_error!, textAlign: TextAlign.center))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_offline || pending > 0) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          margin: const EdgeInsets.only(bottom: 12),
                          decoration: BoxDecoration(
                            color: const Color(0x33FFC107),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            _offline
                                ? 'Modo sin conexión. Se muestra caché local'
                                    '${pending > 0 ? ' · $pending pendiente(s) de sync' : ''}.'
                                : '$pending marcación(es) pendiente(s) de sincronizar.',
                            style: const TextStyle(color: Colors.amberAccent, fontSize: 13),
                          ),
                        ),
                      ],
                      if (_rows.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 48),
                          child: Center(
                            child: Text(
                              'Sin marcaciones en los últimos 60 días',
                              style: TextStyle(color: Colors.white54),
                            ),
                          ),
                        )
                      else
                        ..._rows.map((m) {
                          final synced = m['synced'] == true;
                          final ts = DateTime.tryParse('${m['timestamp']}');
                          final when = ts != null
                              ? DateFormat('dd/MM/yyyy HH:mm').format(ts.toLocal())
                              : '—';
                          final geo = m['ubicacion'] as Map<String, dynamic>?;
                          final lat = geo?['lat'];
                          final lng = geo?['lng'];
                          final geoTxt = (lat != null && lng != null)
                              ? '${(lat as num).toStringAsFixed(5)}, ${(lng as num).toStringAsFixed(5)}'
                              : null;
                          return Card(
                            color: const Color(0xFF12262C),
                            margin: const EdgeInsets.only(bottom: 8),
                            child: ListTile(
                              leading: Icon(
                                synced ? Icons.check_circle : Icons.cloud_upload_outlined,
                                color: synced ? const Color(0xFF2FD4A1) : Colors.orangeAccent,
                              ),
                              title: Text(_labelTipo('${m['tipoMarcacion']}')),
                              subtitle: Text(
                                [
                                  when,
                                  if (geoTxt != null) geoTxt,
                                  synced ? 'Sincronizado' : 'Pendiente de sync',
                                ].join(' · '),
                              ),
                              trailing: synced
                                  ? const Tooltip(
                                      message: 'Sincronizado con el servidor',
                                      child: Icon(Icons.done_all, size: 18, color: Color(0xFF2FD4A1)),
                                    )
                                  : const Tooltip(
                                      message: 'Guardado en el teléfono; se enviará en línea',
                                      child: Icon(Icons.schedule, size: 18, color: Colors.orangeAccent),
                                    ),
                            ),
                          );
                        }),
                    ],
                  ),
                ),
    );
  }
}
