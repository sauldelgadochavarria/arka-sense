import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

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
  String? _descargando;

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

  Future<void> _descargar(Map<String, dynamic> recibo, String tipo) async {
    final id = '${recibo['id']}';
    final key = '$id:$tipo';
    if (_descargando != null) return;
    setState(() => _descargando = key);
    final auth = context.read<AuthState>();
    try {
      final file = await auth.api.download('/recibos/$id/$tipo');
      final dir = await getTemporaryDirectory();
      final safe = file.filename.replaceAll(RegExp(r'[\\/]+'), '_');
      final path = '${dir.path}/$safe';
      await File(path).writeAsBytes(file.bytes, flush: true);
      if (!mounted) return;
      await Share.shareXFiles(
        [XFile(path, mimeType: file.contentType, name: safe)],
        subject: safe,
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo preparar el archivo')),
      );
    } finally {
      if (mounted) setState(() => _descargando = null);
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
            final id = '${r['id']}';
            final tieneXml = r['tieneXml'] == true;
            final pdfKey = '$id:pdf';
            final xmlKey = '$id:xml';
            return Card(
              color: const Color(0xFF12262C),
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.receipt_long, color: Color(0xFF2FD4A1)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '${r['periodoLabel'] ?? '—'}',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(
                          neto != null ? _money.format(neto) : '—',
                          style: const TextStyle(
                            color: Color(0xFF2FD4A1),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Percepciones ${perc != null ? _money.format(perc) : '—'} · '
                      'Deducciones ${ded != null ? _money.format(ded) : '—'}',
                      style: const TextStyle(color: Colors.white54, fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: _descargando == null ? () => _descargar(r, 'pdf') : null,
                          icon: _descargando == pdfKey
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.picture_as_pdf_outlined, size: 18),
                          label: const Text('PDF'),
                        ),
                        TextButton.icon(
                          onPressed: tieneXml && _descargando == null ? () => _descargar(r, 'xml') : null,
                          icon: _descargando == xmlKey
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.code, size: 18),
                          label: Text(tieneXml ? 'XML' : 'Sin XML'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
