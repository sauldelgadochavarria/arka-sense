import 'dart:io' show Platform;
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/auth_state.dart';
import '../services/mlkit_camera.dart';

/// Resultado de la prueba de vida + match 1:1.
class LivenessResult {
  const LivenessResult({
    required this.success,
    required this.message,
    this.confidenceScore = 0,
    this.challengeId,
    this.purpose,
  });

  final bool success;
  final String message;
  final double confidenceScore;
  final String? challengeId;
  final String? purpose;
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
  String? _purpose;
  String? _sesionNombre;
  List<Map<String, dynamic>> _frames = const [];
  int _frameIndex = 0;
  int _attempt = 0;
  int? _countdown;
  int _poseHits = 0;
  bool _scanning = false;
  bool _snapLocked = false;
  bool _resumeLive = false;
  String? _liveHint;
  DateTime _lastScan = DateTime.fromMillisecondsSinceEpoch(0);
  final Map<String, Uint8List> _captured = {};
  final FaceDetector _faces = FaceDetector(
    options: FaceDetectorOptions(
      enableClassification: true,
      performanceMode: FaceDetectorMode.fast,
      minFaceSize: 0.15,
    ),
  );

  bool get _isDesktop {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isLinux || Platform.isMacOS;
  }

  bool get _livePose {
    if (kIsWeb || _isDesktop) return false;
    return Platform.isAndroid || Platform.isIOS;
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
    _faces.close();
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
      CameraController? ctrl;
      Object? cameraError;
      final formats = _livePose
          ? const [ImageFormatGroup.nv21, ImageFormatGroup.yuv420, ImageFormatGroup.jpeg]
          : const [ImageFormatGroup.jpeg];
      for (final format in formats) {
        final attempt = CameraController(
          front,
          _isDesktop ? ResolutionPreset.high : ResolutionPreset.medium,
          enableAudio: false,
          imageFormatGroup: format,
        );
        try {
          await attempt.initialize();
          ctrl = attempt;
          break;
        } catch (e) {
          cameraError = e;
          await attempt.dispose();
        }
      }
      if (ctrl == null) {
        throw cameraError ?? Exception('No se pudo abrir la cámara');
      }
      if (!mounted) return;
      _cam = ctrl;
      await _loadChallenge();
      try {
        await _startLive();
      } catch (_) {
        _liveHint = 'La detección en vivo no arrancó. Usa el botón.';
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _initializing = false);
    }
  }

  Future<void> _loadChallenge() async {
    final data = await context.read<AuthState>().api.get('/biometrics/challenge');
    _challengeId = data['challengeId'] as String?;
    _purpose = data['purpose'] as String?;
    final sesion = data['sesion'];
    if (sesion is Map) {
      final nombre = sesion['nombre']?.toString().trim();
      if (nombre != null && nombre.isNotEmpty) _sesionNombre = nombre;
    }
    final raw = data['requiredFrames'];
    _frames = raw is List
        ? raw.map((e) => Map<String, dynamic>.from(e as Map)).toList()
        : [];
    _frameIndex = 0;
    _captured.clear();
    _instruction = _frames.isNotEmpty
        ? (_frames.first['instruction'] as String? ?? 'Mira a la cámara')
        : 'Mira a la cámara';
    _poseHits = 0;
    _liveHint = _livePose ? _poseHint() : null;
    setState(() {});
  }

  bool get _wantsSmile {
    if (_frames.isEmpty || _frameIndex >= _frames.length) return false;
    final frame = _frames[_frameIndex];
    final id = frame['id']?.toString() ?? '';
    if (frame['step'] != null && _stepAt(_frameIndex) == 2) return true;
    return id == 'frame_action' || id.contains('sonrisa');
  }

  String _poseHint() {
    if (_frames.isEmpty || _frameIndex < 0 || _frameIndex >= _frames.length) {
      return _wantsSmile
          ? 'Sonríe un poco y quédate quieto. La foto sale sola.'
          : 'Rostro relajado, sin sonreír. La foto sale sola.';
    }
    final group = _burstFrom(_frameIndex);
    final place = group.indexOf(_frameIndex);
    final which = group.length > 1 && place >= 0 ? ' Foto ${place + 1} de ${group.length}.' : '';
    return _wantsSmile
        ? 'Sonríe un poco y quédate quieto.$which La foto sale sola.'
        : 'Rostro relajado, sin sonreír.$which La foto sale sola.';
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

  Future<void> _stopLive() async {
    final cam = _cam;
    if (cam != null && cam.value.isStreamingImages) {
      await cam.stopImageStream();
    }
  }

  Future<void> _startLive() async {
    if (!_livePose || _busy) return;
    final cam = _cam;
    if (cam == null || !cam.value.isInitialized || cam.value.isStreamingImages) return;
    _snapLocked = false;
    _poseHits = 0;
    await cam.startImageStream(_onCameraImage);
  }

  void _onCameraImage(CameraImage image) {
    if (_busy || _snapLocked || _scanning || !mounted) return;
    final now = DateTime.now();
    if (now.difference(_lastScan).inMilliseconds < 280) return;
    _lastScan = now;
    _scanFace(image);
  }

  Future<void> _scanFace(CameraImage image) async {
    final cam = _cam;
    if (cam == null) return;
    _scanning = true;
    try {
      final input = inputImageFromCamera(image, cam);
      if (input == null) return;
      final faces = await _faces.processImage(input);
      if (!mounted || _snapLocked || _busy) return;
      if (faces.isEmpty) {
        _poseHits = 0;
        _setLive('Coloca tu rostro dentro del óvalo');
        return;
      }
      final face = faces.reduce(
        (a, b) => a.boundingBox.width >= b.boundingBox.width ? a : b,
      );
      final ready = facePoseReady(face, wantSmile: _wantsSmile);
      if (!ready) {
        _poseHits = 0;
        _setLive(_poseHint());
        return;
      }
      _poseHits += 1;
      _setLive(_wantsSmile ? 'Sonrisa lista…' : 'Rostro listo…');
      if (_poseHits >= 3) {
        _snapLocked = true;
        _poseHits = 0;
        if (mounted) setState(() {});
        Future<void>(() => _captureCurrent(fromLive: true));
      }
    } catch (_) {
      _poseHits = 0;
    } finally {
      _scanning = false;
    }
  }

  void _setLive(String hint) {
    if (_liveHint == hint || !mounted) return;
    setState(() => _liveHint = hint);
  }

  Future<void> _runCountdown() async {
    for (var i = 3; i >= 1; i--) {
      if (!mounted) return;
      setState(() => _countdown = i);
      await Future<void>.delayed(const Duration(milliseconds: 650));
    }
    if (mounted) setState(() => _countdown = null);
  }

  int _stepAt(int index) {
    final raw = _frames[index]['step'];
    if (raw is num) return raw.toInt();
    return index + 1;
  }

  int get _visibleSteps {
    if (_frames.isEmpty) return 0;
    var count = 1;
    var prev = _stepAt(0);
    for (var i = 1; i < _frames.length; i++) {
      final step = _stepAt(i);
      if (step != prev) {
        count += 1;
        prev = step;
      }
    }
    return count;
  }

  int get _currentVisibleStep {
    if (_frames.isEmpty) return 1;
    var count = 1;
    var prev = _stepAt(0);
    for (var i = 1; i <= _frameIndex && i < _frames.length; i++) {
      final step = _stepAt(i);
      if (step != prev) {
        count += 1;
        prev = step;
      }
    }
    return count;
  }

  List<int> _burstFrom(int start) {
    final step = _stepAt(start);
    final hasStep = _frames[start]['step'] != null;
    final group = <int>[start];
    if (!hasStep) return group;
    for (var i = start + 1; i < _frames.length; i++) {
      if (_stepAt(i) != step) break;
      group.add(i);
    }
    return group;
  }

  Future<void> _captureCurrent({bool fromLive = false}) async {
    if (_busy || _frames.isEmpty) return;
    _snapLocked = true;
    setState(() {
      _busy = true;
      _error = null;
    });
    var keepWatching = false;
    try {
      await _stopLive();
      if (!fromLive) await _runCountdown();
      final group = _burstFrom(_frameIndex);
      // En vivo: una foto por vez, y se vuelve a mirar el rostro antes de la siguiente.
      final shots = fromLive ? <int>[_frameIndex] : group;
      for (var k = 0; k < shots.length; k++) {
        if (k > 0) {
          if (mounted) setState(() => _instruction = 'Mantén la pose…');
          await Future<void>.delayed(const Duration(milliseconds: 400));
        }
        final bytes = await _snapBytes();
        if (bytes == null || bytes.isEmpty) {
          throw Exception('No se pudo capturar el fotograma');
        }
        final idx = shots[k];
        final id = _frames[idx]['id'] as String? ?? 'frame_$idx';
        _captured[id] = bytes;
      }

      final last = shots.last;
      if (last + 1 < _frames.length) {
        setState(() {
          _frameIndex = last + 1;
          _instruction =
              _frames[_frameIndex]['instruction'] as String? ?? 'Siguiente gesto';
          _liveHint = _livePose ? _poseHint() : null;
        });
        await Future<void>.delayed(const Duration(milliseconds: 350));
        keepWatching = true;
      } else {
        await _submitVerify();
        keepWatching = _resumeLive;
        _resumeLive = false;
      }
    } catch (e) {
      setState(() => _error = e.toString());
      keepWatching = _livePose;
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _countdown = null;
        });
      }
      if (keepWatching && mounted) {
        try {
          await _startLive();
        } catch (err) {
          if (mounted) setState(() => _error = err.toString());
        }
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
      final data = await context.read<AuthState>().api.postMultipart(
            '/biometrics/verify',
            fields: {
              'challengeId': _challengeId ?? '',
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
          purpose: (data['purpose'] as String?) ?? _purpose,
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
        _resumeLive = true;
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
          _sesionNombre ??
              context.read<AuthState>().displayName,
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(22),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              _purpose == 'enroll'
                  ? 'Enrolando el rostro de esta sesión'
                  : 'Validando el rostro de esta sesión',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ),
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
                          if (_liveHint != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              _liveHint!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Color(0xFF2FD4A1), fontSize: 14),
                            ),
                          ],
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
                            onPressed: (_busy || _snapLocked) ? null : _captureCurrent,
                            icon: _busy
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.camera_alt),
                            label: Text(
                              _livePose
                                  ? (_currentVisibleStep >= _visibleSteps
                                      ? 'Tomar ahora y verificar'
                                      : 'Tomar ahora ($_currentVisibleStep/$_visibleSteps)')
                                  : (_currentVisibleStep >= _visibleSteps
                                      ? 'Capturar y verificar'
                                      : 'Capturar ($_currentVisibleStep/$_visibleSteps)'),
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
