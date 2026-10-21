import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';

class RecibosScreen extends StatefulWidget {
  const RecibosScreen({super.key});

  @override
  State<RecibosScreen> createState() => _RecibosScreenState();
}

class _RecibosScreenState extends State<RecibosScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _recibos = [];

  final _money = NumberFormat.currency(locale: 'es_MX', symbol: '\$');

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
    final auth = context.read<AuthState>();
    try {
      await auth.refreshCapabilities();
      if (!auth.recibosEnabled) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = 'El módulo de recibos no está activo para tu empresa.';
          _recibos = [];
        });
        return;
      }
      final data = await auth.api.get('/recibos');
      final raw = (data['recibos'] as List?) ?? [];
      if (!mounted) return;
      setState(() {
        _recibos =
            raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
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

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.orangeAccent)),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Reintentar')),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Mis recibos', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          const Text(
            'Histórico de nómina publicado por RRHH.',
            style: TextStyle(color: Colors.white54),
          ),
          const SizedBox(height: 16),
          if (_recibos.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 40),
              child: Center(
                child: Text('Aún no hay recibos publicados.', style: TextStyle(color: Colors.white54)),
              ),
            ),
          ..._recibos.map((r) {
            final neto = r['neto'];
            final perc = r['totalPercepciones'];
            final ded = r['totalDeducciones'];
            return Card(
              color: const Color(0xFF12262C),
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                leading: const Icon(Icons.receipt_long, color: Color(0xFF2FD4A1)),
                title: Text('${r['periodoLabel'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(
                  'Percepciones ${perc != null ? _money.format(perc) : '—'} · '
                  'Deducciones ${ded != null ? _money.format(ded) : '—'}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
                trailing: Text(
                  neto != null ? _money.format(neto) : '—',
                  style: const TextStyle(
                    color: Color(0xFF2FD4A1),
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
