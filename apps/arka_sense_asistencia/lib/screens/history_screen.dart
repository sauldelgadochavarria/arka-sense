import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  late DateTime _desde;
  late DateTime _hasta;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _hasta = DateTime(now.year, now.month, now.day);
    _desde = _hasta.subtract(const Duration(days: 13));
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

  String _ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickDesde() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _desde,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: _hasta,
    );
    if (picked == null) return;
    setState(() => _desde = DateTime(picked.year, picked.month, picked.day));
    await _load();
  }

  Future<void> _pickHasta() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _hasta,
      firstDate: _desde,
      lastDate: DateTime.now(),
    );
    if (picked == null) return;
    setState(() => _hasta = DateTime(picked.year, picked.month, picked.day));
    await _load();
  }

  void _preset(int dias) {
    final now = DateTime.now();
    setState(() {
      _hasta = DateTime(now.year, now.month, now.day);
      _desde = _hasta.subtract(Duration(days: dias - 1));
    });
    _load();
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

    final q = 'desde=${_ymd(_desde)}&hasta=${_ymd(_hasta)}';
    try {
      final data = await auth.api.get('/asistencia/historial?$q');
      final raw = (data['marcaciones'] as List?) ?? [];
      final rows = raw
          .whereType<Map>()
          .map((m) => Map<String, dynamic>.from(m))
          .toList();
      await store.cacheServerRows(rows);
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = _filterByRange(merged);
        _offline = false;
      });
    } on ApiException catch (e) {
      if (e.isSessionRevoked) return;
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = _filterByRange(merged);
        _offline = true;
        _error = merged.isEmpty ? e.message : null;
      });
    } catch (e) {
      final merged = await store.mergedHistory();
      if (!mounted) return;
      setState(() {
        _rows = _filterByRange(merged);
        _offline = true;
        _error = merged.isEmpty ? e.toString() : null;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _filterByRange(List<Map<String, dynamic>> all) {
    final start = DateTime(_desde.year, _desde.month, _desde.day);
    final end = DateTime(_hasta.year, _hasta.month, _hasta.day, 23, 59, 59, 999);
    return all.where((m) {
      final ts = DateTime.tryParse('${m['timestamp']}');
      if (ts == null) return true;
      final local = ts.toLocal();
      return !local.isBefore(start) && !local.isAfter(end);
    }).toList();
  }

  void _openDetail(Map<String, dynamic> m) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F2429),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        minChildSize: 0.45,
        maxChildSize: 0.95,
        builder: (_, scrollCtrl) => _PunchDetailSheet(
          row: m,
          labelTipo: _labelTipo,
          scrollController: scrollCtrl,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pending = _rows.where((r) => r['synced'] != true).length;
    final df = DateFormat('dd/MM/yyyy');
    return Scaffold(
      backgroundColor: const Color(0xFF0A1518),
      appBar: AppBar(
        title: const Text('Historial'),
        backgroundColor: const Color(0xFF0D3A4A),
        automaticallyImplyLeading: false,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _loading ? null : _pickDesde,
                        icon: const Icon(Icons.calendar_today, size: 16),
                        label: Text('Desde\n${df.format(_desde)}', textAlign: TextAlign.center),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _loading ? null : _pickHasta,
                        icon: const Icon(Icons.event, size: 16),
                        label: Text('Hasta\n${df.format(_hasta)}', textAlign: TextAlign.center),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    ActionChip(label: const Text('7 días'), onPressed: _loading ? null : () => _preset(7)),
                    ActionChip(label: const Text('14 días'), onPressed: _loading ? null : () => _preset(14)),
                    ActionChip(label: const Text('30 días'), onPressed: _loading ? null : () => _preset(30)),
                    ActionChip(label: const Text('60 días'), onPressed: _loading ? null : () => _preset(60)),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
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
                                    'Sin marcaciones en el rango seleccionado',
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
                                final hasGps = geo?['lat'] != null && geo?['lng'] != null;
                                final device = m['dispositivo'] as Map<String, dynamic>?;
                                final uuid = device?['deviceUuid']?.toString() ?? '';
                                return Card(
                                  color: const Color(0xFF12262C),
                                  margin: const EdgeInsets.only(bottom: 8),
                                  child: ListTile(
                                    onTap: () => _openDetail(m),
                                    leading: Icon(
                                      synced ? Icons.check_circle : Icons.cloud_upload_outlined,
                                      color: synced
                                          ? const Color(0xFF2FD4A1)
                                          : Colors.orangeAccent,
                                    ),
                                    title: Text(_labelTipo('${m['tipoMarcacion']}')),
                                    subtitle: Text(
                                      [
                                        when,
                                        if (hasGps) 'GPS',
                                        if (uuid.isNotEmpty) 'UUID',
                                        synced ? 'Sync' : 'Pendiente',
                                      ].join(' · '),
                                    ),
                                    trailing: const Icon(Icons.chevron_right, color: Colors.white38),
                                  ),
                                );
                              }),
                          ],
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

class _PunchDetailSheet extends StatelessWidget {
  const _PunchDetailSheet({
    required this.row,
    required this.labelTipo,
    required this.scrollController,
  });

  final Map<String, dynamic> row;
  final String Function(String) labelTipo;
  final ScrollController scrollController;

  String _fmt(dynamic iso) {
    final d = DateTime.tryParse('$iso');
    if (d == null) return '—';
    return DateFormat('dd/MM/yyyy HH:mm:ss').format(d.toLocal());
  }

  String _num(dynamic v, {int decimals = 6}) {
    if (v == null) return '—';
    if (v is num) return v.toStringAsFixed(decimals);
    final n = num.tryParse('$v');
    return n?.toStringAsFixed(decimals) ?? '$v';
  }

  Widget _row(String label, String value, {bool copyable = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label, style: const TextStyle(color: Colors.white54, fontSize: 13)),
          ),
          Expanded(
            child: SelectableText(value.isEmpty ? '—' : value, style: const TextStyle(fontSize: 13)),
          ),
          if (copyable && value.isNotEmpty)
            IconButton(
              tooltip: 'Copiar',
              icon: const Icon(Icons.copy, size: 16),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
              },
            ),
        ],
      ),
    );
  }

  Widget _section(String title, List<Widget> children) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF12262C),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF2FD4A1))),
          const SizedBox(height: 6),
          ...children,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final synced = row['synced'] == true;
    final pending = row['pending'] == true;
    final geo = row['ubicacion'] is Map
        ? Map<String, dynamic>.from(row['ubicacion'] as Map)
        : null;
    final device = row['dispositivo'] is Map
        ? Map<String, dynamic>.from(row['dispositivo'] as Map)
        : null;
    final fence = row['geocerca'] is Map
        ? Map<String, dynamic>.from(row['geocerca'] as Map)
        : null;
    final bio = row['biometria'] is Map
        ? Map<String, dynamic>.from(row['biometria'] as Map)
        : null;

    final lat = geo?['lat'];
    final lng = geo?['lng'];
    final mapsUrl = (lat != null && lng != null)
        ? 'https://maps.google.com/?q=${_num(lat)},${_num(lng)}'
        : null;

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: Colors.white24,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
        Text(
          labelTipo('${row['tipoMarcacion']}'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        Text(
          synced ? 'Sincronizado con el servidor' : 'Pendiente de sincronizar',
          style: TextStyle(
            color: synced ? const Color(0xFF2FD4A1) : Colors.orangeAccent,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 14),
        _section('Marcación', [
          _row('Fecha/hora', _fmt(row['timestamp'])),
          _row('Original', _fmt(row['timestampOriginal'])),
          _row('Servidor', _fmt(row['servidorRegisteredAt'])),
          _row('Método', '${row['metodo'] ?? '—'}'),
          _row('Estado', '${row['estado'] ?? '—'}'),
          _row('Origen', '${row['origen'] ?? '—'}'),
          if ('${row['notas'] ?? ''}'.isNotEmpty) _row('Notas', '${row['notas']}'),
          _row('ID registro', '${row['id'] ?? '—'}', copyable: true),
          if (pending) _row('Local', 'Guardado en el teléfono (aún no enviado)'),
        ]),
        _section('GPS / ubicación', [
          _row('Latitud', _num(lat)),
          _row('Longitud', _num(lng)),
          _row(
            'Precisión',
            geo?['accuracyMeters'] != null ? '${_num(geo!['accuracyMeters'], decimals: 1)} m' : '—',
          ),
          _row('Capturado', _fmt(geo?['capturedAt'])),
          _row('Fake GPS', geo?['isMocked'] == true ? 'Sí (rechazable)' : 'No'),
          if (mapsUrl != null) _row('Mapa', mapsUrl, copyable: true),
        ]),
        _section('Dispositivo', [
          _row('UUID móvil', '${device?['deviceUuid'] ?? '—'}', copyable: true),
          _row('Plataforma', '${device?['plataforma'] ?? '—'}'),
          _row('Modelo', '${device?['modelo'] ?? '—'}'),
          _row('App', '${device?['appVersion'] ?? '—'}'),
        ]),
        _section('Geocerca', [
          _row('Sitio', '${fence?['siteNombre'] ?? '—'}'),
          _row('Fuente', '${fence?['siteSource'] ?? '—'}'),
          _row('Política', '${fence?['politica'] ?? '—'}'),
          _row('Fuera de zona', fence?['fueraDeZona'] == true ? 'Sí' : 'No'),
          _row('Permitido', fence?['allowed'] == false ? 'No' : 'Sí'),
          _row(
            'Distancia',
            fence?['distanceMeters'] != null
                ? '${_num(fence!['distanceMeters'], decimals: 1)} m'
                : '—',
          ),
          _row(
            'Radio',
            fence?['radioMetros'] != null ? '${_num(fence!['radioMetros'], decimals: 0)} m' : '—',
          ),
          if ('${fence?['justificacionFueraZona'] ?? ''}'.isNotEmpty)
            _row('Justificación', '${fence?['justificacionFueraZona']}'),
        ]),
        _section('Biometría', [
          _row(
            'Resultado',
            bio?['ok'] == true
                ? 'OK'
                : bio?['ok'] == false
                    ? 'Falló'
                    : '—',
          ),
          _row(
            'Score',
            bio?['score'] != null
                ? '${((bio!['score'] as num) * 100).toStringAsFixed(1)}%'
                : '—',
          ),
          _row('Challenge', '${bio?['challengeId'] ?? '—'}', copyable: true),
          _row('Verificado', _fmt(bio?['verifiedAt'])),
        ]),
      ],
    );
  }
}
