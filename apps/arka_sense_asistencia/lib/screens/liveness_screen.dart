import 'dart:io' show Platform;
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';

/// Resultado de la prueba de vida + match 1:1.
class LivenessResult {
  const LivenessResult({
    required this.success,
    required this.message,
    this.confidenceScore = 0,
    this.challengeId,
  });

  final bool success;
  final String message;
  final double confidenceScore;
  final String? challengeId;
}

/// Flujo guiado: challenge → captura frames → verify (máx. 3 intentos).
class LivenessScreen extends StatefulWidget {
  const LivenessScreen({super.key, this.maxAttempts = 3});

  final int maxAttempts;

  @override
  State<LivenessScreen> createState() => _LivenessScreenState();
}

class _LivenessScreenState extends State<LivenessScreen> {
  CameraController? _cam;
  List<CameraDescription> _cameras = const [];
  bool _initializing = true;
  bool _busy = false;
  String? _error;
  String? _instruction;
  String? _challengeId;
  List<Map<String, dynamic>> _frames = const [];
  int _frameIndex = 0;
  int _attempt = 0;
  int? _countdown;
  final Map<String, Uint8List> _captured = {};

  bool get _isDesktop {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isLinux || Platform.isMacOS;
  }

  bool get _isFrontCamera {
    final cam = _cam;
    if (cam == null) return true;
    return cam.description.lensDirection == CameraLensDirection.front;
  }

  @override
  void initState() {
    super.initState();
    _boot();
  }

  @override
  void dispose() {
    _cam?.dispose();
    super.dispose();
  }

  Future<void> _boot() async {
    setState(() {
      _initializing = true;
      _error = null;
    });
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        throw Exception('No hay cámara disponible en este dispositivo');
      }
      final front = _cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => _cameras.first,
      );
      final ctrl = CameraController(
        front,
        _isDesktop ? ResolutionPreset.high : ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await ctrl.initialize();
      if (!mounted) return;
      _cam = ctrl;
      await _loadChallenge();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _initializing = false);
    }
  }

  Future<void> _loadChallenge() async {
    final data = await context.read<AuthState>().api.get('/biometrics/challenge');
    _challengeId = data['challengeId'] as String?;
    final raw = data['requiredFrames'];
    _frames = raw is List
        ? raw.map((e) => Map<String, dynamic>.from(e as Map)).toList()
        : [];
    _frameIndex = 0;
    _captured.clear();
    _instruction = _frames.isNotEmpty
        ? (_frames.first['instruction'] as String? ?? 'Mira a la cámara')
        : 'Mira a la cámara';
    setState(() {});
  }

  /// Tamaño lógico del preview sin estirar (sensor móvil suele ser landscape).
  Size _previewLogicalSize(CameraController cam) {
    final ps = cam.value.previewSize;
    if (ps == null) return const Size(3, 4);
    if (_isDesktop) {
      return Size(ps.width, ps.height);
    }
    // Android/iOS: sensor landscape → intercambiar para portrait
    return Size(ps.height, ps.width);
  }

  Future<Uint8List?> _snapBytes() async {
    final cam = _cam;
    if (cam == null || !cam.value.isInitialized) return null;
    final shot = await cam.takePicture();
    return shot.readAsBytes();
  }

  Future<void> _runCountdown() async {
    for (var i = 3; i >= 1; i--) {
      if (!mounted) return;
      setState(() => _countdown = i);
      await Future<void>.delayed(const Duration(milliseconds: 650));
    }
    if (mounted) setState(() => _countdown = null);
  }

  Future<void> _captureCurrent() async {
    if (_busy || _frames.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _runCountdown();
      final bytes = await _snapBytes();
      if (bytes == null || bytes.isEmpty) {
        throw Exception('No se pudo capturar el fotograma');
      }
      final id = _frames[_frameIndex]['id'] as String? ?? 'frame_$_frameIndex';
      _captured[id] = bytes;

      if (_frameIndex + 1 < _frames.length) {
        setState(() {
          _frameIndex += 1;
          _instruction =
              _frames[_frameIndex]['instruction'] as String? ?? 'Siguiente gesto';
        });
        await Future<void>.delayed(const Duration(milliseconds: 1200));
      } else {
        await _submitVerify();
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _countdown = null;
        });
      }
    }
  }

  Future<void> _submitVerify() async {
    _attempt += 1;
    setState(() {
      _busy = true;
      _instruction = 'Verificando identidad…';
      _error = null;
    });
    try {
      final emp = context.read<AuthState>().session?['empleado'] as Map?;
      final userId = emp?['id']?.toString() ?? '';
      final data = await context.read<AuthState>().api.postMultipart(
            '/biometrics/verify',
            fields: {
              'challengeId': _challengeId ?? '',
              'userId': userId,
            },
            files: {
              for (final e in _captured.entries) e.key: e.value,
            },
          );

      if (!mounted) return;
      Navigator.of(context).pop(
        LivenessResult(
          success: data['success'] == true || data['ok'] == true,
          message: (data['message'] as String?) ?? 'Verificado',
          confidenceScore: (data['confidenceScore'] as num?)?.toDouble() ?? 0,
          challengeId: _challengeId,
        ),
      );
    } on ApiException catch (e) {
      if (_attempt >= widget.maxAttempts) {
        if (!mounted) return;
        Navigator.of(context).pop(
          LivenessResult(success: false, message: e.message, challengeId: _challengeId),
        );
        return;
      }
      setState(() {
        _error = '${e.message} (intento $_attempt/${widget.maxAttempts})';
        _instruction = 'Reintentando…';
      });
      await Future<void>.delayed(const Duration(milliseconds: 800));
      try {
        await _loadChallenge();
      } catch (err) {
        setState(() => _error = err.toString());
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _buildCameraPreview(CameraController cam) {
    final logical = _previewLogicalSize(cam);
    Widget preview = CameraPreview(cam);

    // Espejo solo en preview frontal (como selfie); la foto enviada no se espeja.
    if (_isFrontCamera && !_isDesktop) {
      preview = Transform(
        alignment: Alignment.center,
        transform: Matrix4.rotationY(math.pi),
        child: preview,
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // cover: llena el marco sin deformar (móvil y desktop)
          FittedBox(
            fit: BoxFit.cover,
            clipBehavior: Clip.hardEdge,
            child: SizedBox(
              width: logical.width,
              height: logical.height,
              child: preview,
            ),
          ),
          IgnorePointer(
            child: CustomPaint(painter: _OvalGuidePainter()),
          ),
          if (_countdown != null)
            ColoredBox(
              color: Colors.black54,
              child: Center(
                child: Text(
                  '$_countdown',
                  style: const TextStyle(
                    fontSize: 72,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF2FD4A1),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cam = _cam;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Prueba de vida (${_attempt.clamp(0, widget.maxAttempts)}/${widget.maxAttempts})',
        ),
      ),
      body: _initializing
          ? const Center(child: CircularProgressIndicator())
          : _error != null && cam == null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(_error!, textAlign: TextAlign.center),
                  ),
                )
              : Column(
                  children: [
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                        child: Center(
                          child: AspectRatio(
                            // Marco portrait fijo: evita squish en Android
                            aspectRatio: 3 / 4,
                            child: _buildCameraPreview(cam!),
                          ),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      child: Column(
                        children: [
                          Text(
                            _instruction ?? '',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            'Llena el óvalo con tu rostro. Evita espejos y otras personas detrás.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white54, fontSize: 13),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.orangeAccent),
                            ),
                          ],
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _busy ? null : _captureCurrent,
                            icon: _busy
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.camera_alt),
                            label: Text(
                              _frameIndex + 1 >= _frames.length &&
                                      _captured.length >= _frames.length - 1
                                  ? 'Capturar y verificar'
                                  : 'Capturar (${_frameIndex + 1}/${_frames.length})',
                            ),
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(52),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _OvalGuidePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final oval = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: size.width * 0.62,
      height: size.height * 0.78,
    );

    final overlay = Path()
      ..addRect(Offset.zero & size)
      ..addOval(oval)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(overlay, Paint()..color = const Color(0x99000000));
    canvas.drawOval(
      oval,
      Paint()
        ..color = const Color(0xFF2FD4A1)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
