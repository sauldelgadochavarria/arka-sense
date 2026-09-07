import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  bool _loading = true;
  String? _error;
  List<dynamic> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await context.read<AuthState>().api.get('/asistencia/historial?dias=14');
      setState(() => _rows = (data['marcaciones'] as List?) ?? []);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Historial (14 días)')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _rows.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final m = _rows[i] as Map<String, dynamic>;
                      final ts = DateTime.tryParse('${m['timestamp']}');
                      final when = ts != null
                          ? DateFormat('dd/MM/yyyy HH:mm').format(ts.toLocal())
                          : '—';
                      final geo = m['ubicacion'] as Map<String, dynamic>?;
                      return ListTile(
                        title: Text('${m['tipoMarcacion']}'),
                        subtitle: Text(
                          geo != null
                              ? '$when · ${geo['lat']?.toStringAsFixed(5)}, ${geo['lng']?.toStringAsFixed(5)}'
                              : when,
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
