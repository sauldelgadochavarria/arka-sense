import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';

class VacacionesScreen extends StatefulWidget {
  const VacacionesScreen({super.key});

  @override
  State<VacacionesScreen> createState() => _VacacionesScreenState();
}

class _VacacionesScreenState extends State<VacacionesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  Map<String, dynamic>? _saldo;
  List<Map<String, dynamic>> _solicitudes = [];
  List<Map<String, dynamic>> _pendientes = [];
  bool _loading = true;
  String? _error;
  DateTimeRange? _range;
  int? _previewDias;
  final _motivo = TextEditingController();

  @override
  void initState() {
    super.initState();
    // 2 tabs; el de aprobaciones solo se muestra si esSupervisor
    _tabs = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _motivo.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final auth = context.read<AuthState>();
    try {
      await auth.refreshCapabilities();
      final data = await auth.api.get('/vacaciones/saldo');
      final sols = (data['solicitudes'] as List?) ?? [];
      List<Map<String, dynamic>> pend = [];
      if (auth.capabilities?['esSupervisor'] == true) {
        try {
          final ap = await auth.api.get('/vacaciones/aprobaciones');
          pend = ((ap['pendientes'] as List?) ?? [])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        } catch (_) {
          /* sin equipo */
        }
      }
      if (!mounted) return;
      setState(() {
        _saldo = data['saldo'] is Map
            ? Map<String, dynamic>.from(data['saldo'] as Map)
            : null;
        _solicitudes =
            sols.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _pendientes = pend;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 2),
      initialDateRange: _range,
    );
    if (picked == null) return;
    setState(() => _range = picked);
    await _preview();
  }

  Future<void> _preview() async {
    if (_range == null) return;
    final auth = context.read<AuthState>();
    final ini = DateFormat('yyyy-MM-dd').format(_range!.start);
    final fin = DateFormat('yyyy-MM-dd').format(_range!.end);
    try {
      final d = await auth.api.get('/vacaciones/preview-dias?inicio=$ini&fin=$fin');
      if (!mounted) return;
      setState(() => _previewDias = (d['dias'] as num?)?.toInt());
    } catch (_) {
      if (!mounted) return;
      setState(() => _previewDias = null);
    }
  }

  Future<void> _solicitar() async {
    if (_range == null) return;
    final auth = context.read<AuthState>();
    try {
      await auth.api.post('/vacaciones/solicitar', {
        'fechaInicio': DateFormat('yyyy-MM-dd').format(_range!.start),
        'fechaFin': DateFormat('yyyy-MM-dd').format(_range!.end),
        'motivo': _motivo.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Solicitud enviada. Saldo reservado.')),
      );
      setState(() {
        _range = null;
        _previewDias = null;
        _motivo.clear();
      });
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _cancelar(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancelar solicitud'),
        content: const Text('¿Seguro que quieres cancelar?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sí')),
        ],
      ),
    );
    if (ok != true) return;
    final auth = context.read<AuthState>();
    try {
      await auth.api.post('/vacaciones/$id/cancelar', {});
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _resolver(String id, String status, {String motivo = ''}) async {
    final auth = context.read<AuthState>();
    try {
      await auth.api.post('/vacaciones/aprobaciones/$id/resolver', {
        'status': status,
        'motivoRechazo': motivo,
      });
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Color _statusColor(String st) {
    switch (st) {
      case 'APPROVED':
        return Colors.greenAccent;
      case 'REJECTED':
        return Colors.redAccent;
      case 'CANCELLED':
        return Colors.white38;
      default:
        return Colors.amberAccent;
    }
  }

  @override
  Widget build(BuildContext context) {
    final disponibles = (_saldo?['diasPendientes'] as num?)?.toInt() ?? 0;
    final esSup = context.watch<AuthState>().capabilities?['esSupervisor'] == true;

    return Column(
      children: [
        if (esSup)
          TabBar(
            controller: _tabs,
            tabs: [
              const Tab(text: 'Mis vacaciones'),
              Tab(
                text: _pendientes.isEmpty
                    ? 'Aprobaciones'
                    : 'Aprobaciones (${_pendientes.length})',
              ),
            ],
          ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)))
                  : esSup
                      ? TabBarView(
                          controller: _tabs,
                          children: [
                            _buildMisVacaciones(disponibles),
                            _buildAprobaciones(),
                          ],
                        )
                      : _buildMisVacaciones(disponibles),
        ),
      ],
    );
  }

  Widget _buildMisVacaciones(int disponibles) {
    final fmt = DateFormat('d MMM y');
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0F3D3A), Color(0xFF12262C)],
              ),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFF2FD4A1).withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Saldo disponible', style: TextStyle(color: Colors.white70)),
                Text(
                  '$disponibles días',
                  style: const TextStyle(
                    fontSize: 36,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF2FD4A1),
                  ),
                ),
                Text(
                  'Corresponden ${_saldo?['diasCorresponden'] ?? 0} · '
                  'Tomados ${_saldo?['diasTomados'] ?? 0} · '
                  'Reservados ${_saldo?['diasCongelados'] ?? 0}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text('Solicitar periodo', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _pickRange,
            icon: const Icon(Icons.date_range),
            label: Text(
              _range == null
                  ? 'Elegir fechas'
                  : '${DateFormat('d MMM').format(_range!.start)} – ${DateFormat('d MMM y').format(_range!.end)}'
                      '${_previewDias != null ? ' · $_previewDias día(s)' : ''}',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _motivo,
            decoration: const InputDecoration(
              labelText: 'Motivo (opcional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _range == null ? null : _solicitar,
            child: const Text('Enviar solicitud'),
          ),
          const SizedBox(height: 24),
          const Text('Historial', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (_solicitudes.isEmpty)
            const Text('Sin solicitudes aún.', style: TextStyle(color: Colors.white54)),
          ..._solicitudes.map((s) {
            final st = '${s['status'] ?? ''}';
            final id = '${s['_id'] ?? s['id'] ?? ''}';
            final ini = DateTime.tryParse('${s['fechaInicio']}');
            final fin = DateTime.tryParse('${s['fechaFin']}');
            final canCancel = st == 'PENDING' || st == 'APPROVED';
            return Card(
              color: const Color(0xFF12262C),
              child: ListTile(
                title: Text(
                  ini != null && fin != null
                      ? '${fmt.format(ini.toLocal())} – ${fmt.format(fin.toLocal())}'
                      : 'Periodo',
                ),
                subtitle: Text('${s['diasSolicitados'] ?? '—'} días · $st'),
                leading: Icon(Icons.beach_access, color: _statusColor(st)),
                trailing: canCancel
                    ? IconButton(
                        icon: const Icon(Icons.cancel_outlined),
                        onPressed: () => _cancelar(id),
                      )
                    : null,
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildAprobaciones() {
    final fmt = DateFormat('d MMM');
    if (_pendientes.isEmpty) {
      return const Center(
        child: Text('No hay solicitudes pendientes de tu equipo.',
            style: TextStyle(color: Colors.white54)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _pendientes.length,
        itemBuilder: (ctx, i) {
          final p = _pendientes[i];
          final emp = p['empleado'] is Map
              ? Map<String, dynamic>.from(p['empleado'] as Map)
              : null;
          final id = '${p['_id'] ?? p['id'] ?? ''}';
          final ini = DateTime.tryParse('${p['fechaInicio']}');
          final fin = DateTime.tryParse('${p['fechaFin']}');
          return Card(
            color: const Color(0xFF12262C),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    emp?['nombre']?.toString() ?? 'Empleado',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    ini != null && fin != null
                        ? '${fmt.format(ini.toLocal())} – ${fmt.format(fin.toLocal())} · ${p['diasSolicitados']} días'
                        : '',
                    style: const TextStyle(color: Colors.white70),
                  ),
                  if ('${p['motivo'] ?? ''}'.isNotEmpty)
                    Text('${p['motivo']}', style: const TextStyle(color: Colors.white54)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      FilledButton(
                        onPressed: () => _resolver(id, 'APPROVED'),
                        child: const Text('Aprobar'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: () async {
                          final ctrl = TextEditingController();
                          final motivo = await showDialog<String>(
                            context: context,
                            builder: (dCtx) => AlertDialog(
                              title: const Text('Rechazar'),
                              content: TextField(
                                controller: ctrl,
                                decoration: const InputDecoration(labelText: 'Motivo'),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(dCtx),
                                  child: const Text('Cancelar'),
                                ),
                                FilledButton(
                                  onPressed: () => Navigator.pop(dCtx, ctrl.text),
                                  child: const Text('Rechazar'),
                                ),
                              ],
                            ),
                          );
                          if (motivo != null) {
                            await _resolver(id, 'REJECTED', motivo: motivo);
                          }
                        },
                        child: const Text('Rechazar'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
