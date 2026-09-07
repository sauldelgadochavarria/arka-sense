import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';
import '../services/location_service.dart';
import 'history_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _location = LocationService();
  Map<String, dynamic>? _hoy;
  bool _loading = true;
  bool _punching = false;
  String? _error;
  String? _tipoSeleccionado;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await context.read<AuthState>().api.get('/asistencia/hoy');
      setState(() {
        _hoy = data;
        _tipoSeleccionado = data['sugerido'] as String?;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _labelTipo(String value) {
    final tipos = (_hoy?['tiposMarcacion'] as List?) ?? [];
    for (final t in tipos) {
      if (t is Map && t['value'] == value) return t['label']?.toString() ?? value;
    }
    return value;
  }

  Future<void> _marcar() async {
    final tipo = _tipoSeleccionado;
    if (tipo == null || tipo.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Jornada completa o sin tipo seleccionado')),
      );
      return;
    }
    setState(() => _punching = true);
    try {
      final geo = await _location.currentPosition();
      final body = {
        'tipoMarcacion': tipo,
        'lat': geo.lat,
        'lng': geo.lng,
        'accuracyMeters': geo.accuracyMeters,
        ...LocationService.deviceMeta(),
      };
      final res = await context.read<AuthState>().api.post('/asistencia/marcar', body);
      if (!mounted) return;
      final est = res['asistenciaDia'] as Map<String, dynamic>?;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Registrado: ${_labelTipo(tipo)}'
            '${est != null ? ' · ${est['estatusLabel']}' : ''}',
          ),
        ),
      );
      await _refresh();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _punching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final marcaciones = (_hoy?['marcaciones'] as List?) ?? [];
    final sugerido = _hoy?['sugerido'] as String?;
    final completa = _hoy?['jornadaCompleta'] == true;
    final tipos = (_hoy?['tiposMarcacion'] as List?) ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Asistencia'),
        actions: [
          IconButton(
            tooltip: 'Historial',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const HistoryScreen()),
              );
            },
            icon: const Icon(Icons.history),
          ),
          IconButton(
            tooltip: 'Salir',
            onPressed: () => auth.logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(auth.displayName, style: Theme.of(context).textTheme.headlineSmall),
            Text(
              [
                if (auth.numEmpleado.isNotEmpty) '#${auth.numEmpleado}',
                auth.tenantLabel,
              ].where((e) => e.isNotEmpty).join(' · '),
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 20),
            if (_loading)
              const Center(child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(),
              ))
            else if (_error != null)
              Text(_error!, style: const TextStyle(color: Colors.orangeAccent))
            else ...[
              Card(
                color: const Color(0xFF0D2228),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Hoy · ${_hoy?['fecha'] ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 8),
                      if (completa)
                        const Text('Jornada completa (salida registrada).')
                      else
                        Text('Siguiente sugerido: ${sugerido != null ? _labelTipo(sugerido) : '—'}'),
                      const SizedBox(height: 12),
                      if (marcaciones.isEmpty)
                        const Text('Sin marcaciones aún.', style: TextStyle(color: Colors.white54))
                      else
                        ...marcaciones.map((m) {
                          final map = m as Map<String, dynamic>;
                          final ts = DateTime.tryParse('${map['timestamp']}');
                          final hora = ts != null ? DateFormat.Hm().format(ts.toLocal()) : '—';
                          return ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.check_circle, color: Color(0xFF2FD4A1)),
                            title: Text(_labelTipo('${map['tipoMarcacion']}')),
                            trailing: Text(hora),
                          );
                        }),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              if (!completa) ...[
                DropdownButtonFormField<String>(
                  value: _tipoSeleccionado,
                  decoration: const InputDecoration(labelText: 'Tipo de marcación'),
                  items: [
                    for (final t in tipos)
                      if (t is Map && t['value'] != null)
                        DropdownMenuItem(
                          value: t['value'] as String,
                          child: Text('${t['label']}'),
                        ),
                  ],
                  onChanged: _punching
                      ? null
                      : (v) => setState(() => _tipoSeleccionado = v),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _punching ? null : _marcar,
                  icon: _punching
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.fingerprint),
                  label: Text(
                    _tipoSeleccionado != null
                        ? 'Registrar ${_labelTipo(_tipoSeleccionado!)}'
                        : 'Registrar',
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Se capturará tu ubicación GPS al confirmar.',
                  style: TextStyle(color: Colors.white54, fontSize: 13),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
